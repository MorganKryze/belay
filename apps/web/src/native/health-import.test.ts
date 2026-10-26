import type { Change, SyncRequest } from "@belay/shared/sync/schema";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AccountDb, openAccountDb, readOutbox, recordChange } from "@/sync/db";
import { createSyncEngine, type Send } from "@/sync/engine";
import { answer } from "@/test/answer";

const native = vi.hoisted(() => ({
  health: vi.fn(),
  get then(): never {
    throw new Error('"BelayNative.then()" is not implemented on ios');
  },
}));
vi.mock("./plugin", () => ({ BelayNative: native }));

import { type HealthSample, IMPORT_KEY, readHealth, setHealthOn, setImportOn } from "./health";
import { earliestPerDay, importAfterSync, importWeighings } from "./health-import";

// The phone's local time: the import was turned on on the 26th at 07:00.
const ON = new Date(2026, 9, 26, 7, 0);
const NOW = new Date(2026, 9, 26, 9, 30);
const at = (h: number, mi = 0) => new Date(2026, 9, 26, h, mi).getTime();
const weight = (
  date: string,
  weightKg: number | null,
  when = "2026-10-26T05:00:00.000Z",
): Change => ({
  kind: "weight",
  date,
  weightKg,
  at: when,
});

let db: AccountDb;
beforeEach(async () => {
  indexedDB = new IDBFactory();
  db = await openAccountDb("user-a");
  native.health.mockReset();
  await setHealthOn(db, true, ON.getTime());
  await setImportOn(db, true, ON.getTime());
});
const day = async (date: string) => db.get("weights", date);
// An import whose read of Health began from what is stored now.
const take = async (samples: readonly HealthSample[], anchor: string, now: Date) => {
  const { settings, imported } = await readHealth(db);
  const from = { anchor: imported.anchor, since: settings.importSince ?? 0 };
  return importWeighings(db, samples, anchor, now, from);
};
const queued = async () => (await readOutbox(db)).map((e) => e.change);

describe("the readings kept", () => {
  it("one per local day, the earliest, rounded to 0.1 kg, from the import's day on", () => {
    const days = earliestPerDay(
      [
        { startedAt: at(8, 10), kg: 80.44 },
        { startedAt: at(6, 50), kg: 80.96 },
        { startedAt: new Date(2026, 9, 25, 7).getTime(), kg: 81 },
      ],
      "2026-10-26",
    );
    expect([...days]).toEqual([["2026-10-26", { startedAt: at(6, 50), kg: 81 }]]);
  });

  it("a reading outside 20 to 400 kg is left out, the day's next one kept", () => {
    const days = earliestPerDay(
      [
        { startedAt: at(6), kg: 12.5 },
        { startedAt: at(7), kg: 80.2 },
        { startedAt: at(8), kg: 401 },
      ],
      "2026-10-26",
    );
    expect(days.get("2026-10-26")).toEqual({ startedAt: at(7), kg: 80.2 });
  });

  it("a reading at 00:30 local belongs to that day", () => {
    const startedAt = new Date(2026, 9, 27, 0, 30).getTime();
    const days = earliestPerDay([{ startedAt, kg: 80 }], "2026-10-26");
    expect([...days.keys()]).toEqual(["2026-10-27"]);
  });
});

describe("a day and its record", () => {
  it("a day with no record takes the reading, queued as an ordinary weigh-in, with the anchor", async () => {
    expect(await take([{ startedAt: at(7, 5), kg: 80.4 }], "A1", NOW)).toBe(1);
    expect(await day("2026-10-26")).toEqual({
      date: "2026-10-26",
      weightKg: 80.4,
      at: NOW.toISOString(),
    });
    expect(await queued()).toEqual([weight("2026-10-26", 80.4, NOW.toISOString())]);
    expect((await readHealth(db)).imported).toEqual({
      anchor: "A1",
      filled: { "2026-10-26": { at: NOW.toISOString(), startedAt: at(7, 5) } },
    });
  });

  it("its own reading, untouched, gives way to an earlier one only", async () => {
    await take([{ startedAt: at(7, 5), kg: 80.4 }], "A1", NOW);
    const later = new Date(NOW.getTime() + 60_000);
    expect(await take([{ startedAt: at(8), kg: 79 }], "A2", later)).toBe(0);
    expect(await take([{ startedAt: at(6, 40), kg: 80.9 }], "A3", later)).toBe(1);
    expect((await day("2026-10-26"))?.weightKg).toBe(80.9);
    expect((await readHealth(db)).imported.anchor).toBe("A3");
  });

  it("a weigh-in typed here or on another device, an edit or a deletion always wins", async () => {
    await recordChange(db, weight("2026-10-26", 82.1));
    expect(await take([{ startedAt: at(6), kg: 80.4 }], "A1", NOW)).toBe(0);
    expect((await day("2026-10-26"))?.weightKg).toBe(82.1);

    indexedDB = new IDBFactory();
    db = await openAccountDb("user-a");
    await setHealthOn(db, true, ON.getTime());
    await setImportOn(db, true, ON.getTime());
    await recordChange(db, weight("2026-10-26", null));
    expect(await take([{ startedAt: at(6), kg: 80.4 }], "A1", NOW)).toBe(0);
    expect((await day("2026-10-26"))?.weightKg).toBeNull();
  });

  it("its own reading edited in Belay is the person's now", async () => {
    await take([{ startedAt: at(7, 5), kg: 80.4 }], "A1", NOW);
    await recordChange(
      db,
      weight("2026-10-26", 80.0, new Date(NOW.getTime() + 1000).toISOString()),
    );
    expect(await take([{ startedAt: at(6), kg: 79.5 }], "A2", NOW)).toBe(0);
    expect((await day("2026-10-26"))?.weightKg).toBe(80);
  });

  it("a reading dated after today waits for its day: the anchor stays before it", async () => {
    const tomorrow = { startedAt: new Date(2026, 9, 27, 7).getTime(), kg: 79.8 };
    const samples = [{ startedAt: at(7, 5), kg: 80.4 }, tomorrow];
    expect(await take(samples, "A1", NOW)).toBe(1);
    expect(await day("2026-10-27")).toBeUndefined();
    expect((await readHealth(db)).imported.anchor).toBeNull();

    // Health read again from the same place on the 27th: that reading is taken, once.
    expect(await take(samples, "A1", new Date(2026, 9, 27, 9))).toBe(1);
    expect((await day("2026-10-27"))?.weightKg).toBe(79.8);
    expect((await day("2026-10-26"))?.weightKg).toBe(80.4);
    expect((await readHealth(db)).imported.anchor).toBe("A1");
    expect(await queued()).toHaveLength(2);
  });

  it("nothing new writes nothing", async () => {
    const before = await db.get("meta", IMPORT_KEY);
    expect(await take([], "A1", NOW)).toBe(0);
    expect(await db.get("meta", IMPORT_KEY)).toEqual(before);
    expect(await queued()).toEqual([]);
  });

  it("turned off while Health was read, nothing is taken", async () => {
    await setImportOn(db, false, NOW.getTime());
    expect(await take([{ startedAt: at(7), kg: 80.4 }], "A1", NOW)).toBe(0);
    expect(await day("2026-10-26")).toBeUndefined();
  });

  it("turned off and on again while Health was read, the new start's place stands", async () => {
    await take([{ startedAt: at(7, 5), kg: 80.4 }], "A1", NOW);
    const from = { anchor: "A1", since: new Date(2026, 9, 26).getTime() };
    await setImportOn(db, false, NOW.getTime());
    await setImportOn(db, true, NOW.getTime());
    expect(await importWeighings(db, [{ startedAt: at(6), kg: 79.5 }], "A2", NOW, from)).toBe(0);
    expect((await readHealth(db)).imported.anchor).toBeNull();
    expect((await day("2026-10-26"))?.weightKg).toBe(80.4);
    expect(await queued()).toHaveLength(1);
  });

  it("the setting off, then on, then the import on, reads Health from the start again", async () => {
    await take([{ startedAt: at(7, 5), kg: 80.4 }], "A1", NOW);
    await setHealthOn(db, false, NOW.getTime());
    await setHealthOn(db, true, NOW.getTime());
    expect((await readHealth(db)).imported.anchor).toBe("A1");
    await setImportOn(db, true, NOW.getTime());
    expect((await readHealth(db)).imported.anchor).toBeNull();
  });
});

describe("after a landed sync", () => {
  it("reads Health from its anchor, writes the day, and the next sync sends it once", async () => {
    const requests: SyncRequest[] = [];
    const send = vi.fn<Send>(async (request) => {
      requests.push(request);
      return { kind: "ok", response: answer({ cursor: String(requests.length) }) };
    });
    const refresh = vi.fn(async () => {});
    const engine = createSyncEngine({ userId: "user-a", db, send, onApplied: () => {} });
    const schedule = vi.spyOn(engine, "schedule");
    native.health
      .mockResolvedValueOnce({ samples: [{ startedAt: at(7, 5), kg: 80.4 }], anchor: "A1" })
      .mockResolvedValue({ samples: [], anchor: "A1" });
    let imports: Promise<void> = Promise.resolve();
    engine.onLanded(() => {
      imports = importAfterSync({ db, engine }, refresh, () => NOW);
    });

    await engine.sync();
    await vi.waitFor(() => expect(native.health).toHaveBeenCalledOnce());
    await imports;
    expect(native.health).toHaveBeenCalledWith({
      op: "readWeighings",
      anchor: null,
      since: new Date(2026, 9, 26).getTime(),
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();

    // The next sync, scheduled or not, sends it; an entry may still be queued when it is read.
    await engine.sync();
    await vi.waitFor(() => expect(native.health).toHaveBeenCalledTimes(2));
    await imports;
    const sent = requests.flatMap((r) => r.changes);
    expect([...new Set([...sent, ...(await queued())].map((c) => JSON.stringify(c)))]).toEqual([
      JSON.stringify(weight("2026-10-26", 80.4, NOW.toISOString())),
    ]);
    // Nothing new in Health: no second write, no sync asked.
    expect(schedule).toHaveBeenCalledOnce();
    expect(native.health).toHaveBeenLastCalledWith({
      op: "readWeighings",
      anchor: "A1",
      since: new Date(2026, 9, 26).getTime(),
    });
  });

  it("with the import off, Health is not asked", async () => {
    await setImportOn(db, false, NOW.getTime());
    await importAfterSync({ db, engine: { schedule: vi.fn() } }, async () => {});
    expect(native.health).not.toHaveBeenCalled();
  });

  it("asks for a sync even when showing the new weigh-ins fails", async () => {
    native.health.mockResolvedValue({ samples: [{ startedAt: at(7, 5), kg: 80.4 }], anchor: "A1" });
    const schedule = vi.fn();
    const refresh = vi.fn(async () => {
      throw new Error("the screen went away");
    });
    await importAfterSync({ db, engine: { schedule } }, refresh, () => NOW);
    expect(refresh).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
  });

  it("Health unavailable leaves everything as it was, for the next landed sync", async () => {
    native.health.mockRejectedValue(new Error("health unavailable"));
    await importAfterSync({ db, engine: { schedule: vi.fn() } }, async () => {});
    expect((await readHealth(db)).imported).toEqual({ anchor: null, filled: {} });
  });
});
