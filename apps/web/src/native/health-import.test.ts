import { mergeWeights } from "@belay/shared/sync/merge";
import type { Change, SyncRequest, WeightChange } from "@belay/shared/sync/schema";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AccountDb, applyServer, openAccountDb, readOutbox, recordChange } from "@/sync/db";
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
// The stamp of a weigh-in imported for the 26th: the start of that day.
const MIDNIGHT = new Date(2026, 9, 26).toISOString();
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
      at: MIDNIGHT,
    });
    expect(await queued()).toEqual([weight("2026-10-26", 80.4, MIDNIGHT)]);
    expect((await readHealth(db)).imported).toEqual({
      anchor: "A1",
      filled: { "2026-10-26": { at: MIDNIGHT, startedAt: at(7, 5) } },
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

describe("across devices", () => {
  // Typed on a computer at 08:00 while offline, before the phone imported the day at 09:30.
  const typed: WeightChange = {
    kind: "weight",
    date: "2026-10-26",
    weightKg: 82.1,
    at: new Date(2026, 9, 26, 8).toISOString(),
  };
  const serverNow = new Date(2026, 9, 26, 10);
  const weighIns = async () =>
    (await queued()).filter((c): c is WeightChange => c.kind === "weight");

  it("a weigh-in typed for the day, even before the import ran, wins on the server and the phone", async () => {
    await take([{ startedAt: at(7, 5), kg: 80.4 }], "A1", NOW);
    const [imported] = await weighIns();
    expect(imported).toEqual(weight("2026-10-26", 80.4, MIDNIGHT));
    // On the server, whichever of the two arrives first.
    expect(mergeWeights(new Map([["2026-10-26", imported!.at]]), [typed], serverNow)).toEqual([
      typed,
    ]);
    expect(mergeWeights(new Map([["2026-10-26", typed.at]]), [imported!], serverNow)).toEqual([]);
    // On the phone, the typed day landing while the import is still queued.
    const row = { date: "2026-10-26", weightKg: 82.1, at: typed.at };
    await applyServer(db, [], answer({ weights: [row] }));
    expect(await day("2026-10-26")).toEqual(row);
  });

  it("an earlier reading still replaces the import's own, stamped just after it", async () => {
    await take([{ startedAt: at(7, 5), kg: 80.4 }], "A1", NOW);
    expect(await take([{ startedAt: at(6, 40), kg: 80.9 }], "A2", NOW)).toBe(1);
    const after = new Date(Date.parse(MIDNIGHT) + 1).toISOString();
    expect(await day("2026-10-26")).toEqual({ date: "2026-10-26", weightKg: 80.9, at: after });
    const [first, second] = await weighIns();
    expect(second).toEqual(weight("2026-10-26", 80.9, after));
    // The server holds the first: the second replaces it, and a typed weigh-in beats both.
    expect(mergeWeights(new Map([["2026-10-26", first!.at]]), [second!], serverNow)).toEqual([
      second,
    ]);
    expect(mergeWeights(new Map([["2026-10-26", second!.at]]), [typed], serverNow)).toEqual([
      typed,
    ]);
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
      JSON.stringify(weight("2026-10-26", 80.4, MIDNIGHT)),
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
    expect((await readHealth(db)).imported).toEqual({
      anchor: null,
      filled: {},
      historyDone: false,
    });
  });
});
