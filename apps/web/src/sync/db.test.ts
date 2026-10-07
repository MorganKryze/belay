import type { Change } from "@belay/shared/sync/schema";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  type AccountDb,
  applyServer,
  openAccountDb,
  pendingCounts,
  readCursor,
  readOutbox,
  readTarget,
  readWeights,
  recordChange,
} from "./db";

const AT = "2026-10-07T06:30:00.000Z";
const LATER = "2026-10-07T06:31:00.000Z";
const weight = (date: string, weightKg: number | null, at = AT): Change => ({
  kind: "weight",
  date,
  weightKg,
  at,
});

let db: AccountDb;
beforeEach(async () => {
  indexedDB = new IDBFactory(); // a fresh device for every test
  db = await openAccountDb("user-a");
});

describe("recordChange", () => {
  it("writes the value and queues its change together", async () => {
    await recordChange(db, weight("2026-10-07", 79.8));
    expect(await readWeights(db)).toEqual([{ date: "2026-10-07", weightKg: 79.8 }]);
    expect((await readOutbox(db)).map((e) => e.change)).toEqual([weight("2026-10-07", 79.8)]);
  });

  it("refuses a change outside the contract, which would block the queue", async () => {
    await expect(recordChange(db, weight("2026-10-07", 401))).rejects.toThrow(RangeError);
    expect(await readWeights(db)).toEqual([]);
    expect(await readOutbox(db)).toEqual([]);
  });

  it("hides a deleted day but keeps its change queued", async () => {
    await recordChange(db, weight("2026-10-07", 79.8));
    await recordChange(db, weight("2026-10-07", null, LATER));
    expect(await readWeights(db)).toEqual([]);
    expect(await readOutbox(db)).toHaveLength(2);
  });

  it("keeps the target range, 0.5 to 1 % until one is written", async () => {
    expect(await readTarget(db)).toEqual({ minPct: 0.5, maxPct: 1 });
    await recordChange(db, { kind: "target", minPct: 0.25, maxPct: 0.75, at: AT });
    expect(await readTarget(db)).toEqual({ minPct: 0.25, maxPct: 0.75 });
  });

  it("counts what waits as a person would: one per day, plus the range", async () => {
    await recordChange(db, weight("2026-10-07", 80));
    await recordChange(db, weight("2026-10-07", 79.8, LATER));
    await recordChange(db, weight("2026-10-06", 80.2));
    await recordChange(db, { kind: "target", minPct: 0.25, maxPct: 0.75, at: AT });
    expect(await pendingCounts(db)).toEqual({ weighings: 2, total: 3 });
  });
});

describe("one database per account", () => {
  it("never shows one account's weigh-ins to another on the same device", async () => {
    await recordChange(db, weight("2026-10-07", 79.8));
    const other = await openAccountDb("user-b");
    expect(await readWeights(other)).toEqual([]);
    expect(await readOutbox(other)).toEqual([]);
    expect(other.name).toBe("belay.user-b");
  });
});

describe("applyServer", () => {
  it("drops exactly the changes sent, takes the rows and keeps the cursor", async () => {
    await recordChange(db, weight("2026-10-06", 80.2));
    await recordChange(db, weight("2026-10-07", 79.8));
    const sent = await readOutbox(db, 1);
    await applyServer(db, [sent[0]!.id], {
      cursor: "42",
      weights: [
        { date: "2026-10-06", weightKg: 80.2, at: AT },
        { date: "2026-10-01", weightKg: 81, at: AT },
      ],
      target: { minPct: 0.5, maxPct: 1, at: null },
      hasMore: false,
    });
    expect((await readOutbox(db)).map((e) => e.change)).toEqual([weight("2026-10-07", 79.8)]);
    expect(await readCursor(db)).toBe("42");
    expect((await readWeights(db)).map((w) => w.date)).toEqual([
      "2026-10-01",
      "2026-10-06",
      "2026-10-07",
    ]);
  });

  it("puts a change entered during the request back on top of an older server row", async () => {
    await recordChange(db, weight("2026-10-07", 79.6, LATER)); // entered while the request was out
    await applyServer(db, [], {
      cursor: "7",
      weights: [{ date: "2026-10-07", weightKg: 80, at: AT }], // another device, earlier
      target: null,
      hasMore: false,
    });
    expect(await readWeights(db)).toEqual([{ date: "2026-10-07", weightKg: 79.6 }]);
  });

  it("lets a later write from another device show over an older pending change", async () => {
    await recordChange(db, weight("2026-10-07", 79.6, AT));
    await applyServer(db, [], {
      cursor: "8",
      weights: [{ date: "2026-10-07", weightKg: 80, at: LATER }],
      target: null,
      hasMore: false,
    });
    expect(await readWeights(db)).toEqual([{ date: "2026-10-07", weightKg: 80 }]);
    expect(await readOutbox(db)).toHaveLength(1); // still sent: the server decides
  });
});

describe("failures", () => {
  it("rejects once when a server answer cannot be stored, and changes nothing", async () => {
    await recordChange(db, weight("2026-10-07", 79.8));
    const [sent] = await readOutbox(db);
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    const bad = {
      cursor: "9",
      weights: [
        { date: "2026-10-01", weightKg: 81, at: AT },
        { date: {}, weightKg: 80, at: AT },
      ],
      target: null,
      hasMore: false,
    } as unknown as Parameters<typeof applyServer>[2];
    await expect(applyServer(db, [sent!.id], bad)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
    expect(await readOutbox(db)).toHaveLength(1);
    expect(await readWeights(db)).toEqual([{ date: "2026-10-07", weightKg: 79.8 }]);
    expect(await readCursor(db)).toBe("0");
  });

  it("rejects when IndexedDB is unavailable", async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error a private window without storage
    globalThis.indexedDB = undefined;
    try {
      await expect(openAccountDb("user-c")).rejects.toThrow();
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});
