import type { Change } from "@belay/shared/sync/schema";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import { answer as server } from "@/test/answer";
import {
  accountDbName,
  type AccountDb,
  applyServer,
  openAccountDb,
  pendingCounts,
  readAnnotations,
  readCursor,
  readIntake,
  readMeasures,
  readOutbox,
  readProfile,
  readSupplementLogs,
  readSupplements,
  readTarget,
  readWeights,
  recordChange,
  recordChanges,
} from "./db";

const AT = "2026-10-07T06:30:00.000Z";
const LATER = "2026-10-07T06:31:00.000Z";
const S = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f"; // a supplement
const N = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90"; // an annotation

beforeEach(() => {
  indexedDB = new IDBFactory(); // a fresh device for every test
});

describe("the upgrade from version 1", () => {
  it("keeps the weigh-ins, the range, the queue and the cursor, while a tab still holds version 1", async () => {
    // The database as M2a left it, held open by a tab running M2a's code.
    let closedForUpgrade = false;
    const v1 = await openDB(accountDbName("user-a"), 1, {
      upgrade(db) {
        db.createObjectStore("weights", { keyPath: "date" });
        db.createObjectStore("profile");
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("meta");
      },
      blocking(_current, _blocked, event) {
        closedForUpgrade = true;
        (event.target as IDBDatabase).close();
      },
    });
    const queued: Change = { kind: "weight", date: "2026-10-07", weightKg: 79.8, at: AT };
    await v1.put("weights", { date: "2026-10-06", weightKg: 80.2, at: AT });
    await v1.put("weights", { date: "2026-10-07", weightKg: 79.8, at: AT });
    await v1.put("profile", { minPct: 0.25, maxPct: 0.75, at: AT }, "target");
    await v1.add("outbox", { change: queued });
    await v1.add("outbox", { change: { kind: "target", minPct: 0.25, maxPct: 0.75, at: AT } });
    await v1.put("meta", "12", "cursor");

    const db = await openAccountDb("user-a");
    expect(closedForUpgrade).toBe(true);
    expect(db.version).toBe(2);
    expect((await readWeights(db)).map((w) => w.weightKg)).toEqual([80.2, 79.8]);
    expect(await readTarget(db)).toEqual({ minPct: 0.25, maxPct: 0.75 });
    expect((await readOutbox(db)).map((e) => [e.id, e.change.kind])).toEqual([
      [1, "weight"],
      [2, "target"],
    ]);
    expect(await readCursor(db)).toBe("12");
    // The new stores are there, and the queue goes on from where it was.
    await recordChange(db, {
      kind: "measure",
      date: "2026-10-07",
      field: "waist",
      value: 82,
      at: AT,
    });
    expect((await readOutbox(db)).map((e) => e.id)).toEqual([1, 2, 3]);
    db.close();
  });
});

let db: AccountDb;
const open = async () => {
  db = await openAccountDb("user-a");
};

describe("the new entries", () => {
  beforeEach(open);

  it("keep each measurement and intake value of a day, and their queue", async () => {
    await recordChanges(db, [
      { kind: "measure", date: "2026-10-06", field: "waist", value: 82, at: AT },
      { kind: "measure", date: "2026-10-06", field: "neck", value: 39, at: AT },
      { kind: "intake", date: "2026-10-07", field: "kcal", value: 2100, at: AT },
      { kind: "intake", date: "2026-10-07", field: "protein", value: null, at: AT },
    ]);
    expect(await readMeasures(db)).toEqual([
      { date: "2026-10-06", waistCm: 82, neckCm: 39, hipCm: null },
    ]);
    expect(await readIntake(db)).toEqual([{ date: "2026-10-07", kcal: 2100, proteinG: null }]);
    expect(await readOutbox(db)).toHaveLength(4);
  });

  it("write nothing of a group when one change is invalid", async () => {
    await expect(
      recordChanges(db, [
        { kind: "intake", date: "2026-10-07", field: "kcal", value: 2100, at: AT },
        { kind: "intake", date: "2026-10-07", field: "protein", value: 501, at: AT },
      ]),
    ).rejects.toThrow(RangeError);
    expect(await readIntake(db)).toEqual([]);
    expect(await readOutbox(db)).toEqual([]);
  });

  it("write nothing of a group when the device refuses one write inside the transaction", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    // A device that refuses the second queue entry (a full disk), after the first value is written.
    let adds = 0;
    const failing = {
      transaction: (...args: Parameters<AccountDb["transaction"]>) => {
        const tx = db.transaction(...args);
        return new Proxy(tx, {
          get(target, key) {
            if (key !== "objectStore") {
              const value = Reflect.get(target, key, target);
              return typeof value === "function" ? value.bind(target) : value;
            }
            return (name: Parameters<typeof tx.objectStore>[0]) => {
              const store = target.objectStore(name);
              if (name !== "outbox") return store;
              return {
                add: (value: Parameters<NonNullable<typeof store.add>>[0]) =>
                  ++adds === 2
                    ? Promise.reject(new DOMException("full", "QuotaExceededError"))
                    : store.add!(value),
              };
            };
          },
        });
      },
    } as unknown as AccountDb;

    await expect(
      recordChanges(failing, [
        { kind: "intake", date: "2026-10-07", field: "kcal", value: 2100, at: AT },
        { kind: "intake", date: "2026-10-07", field: "protein", value: 140, at: AT },
      ]),
    ).rejects.toMatchObject({ name: "QuotaExceededError" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", onUnhandled);

    expect(adds).toBe(2);
    expect(await readIntake(db)).toEqual([]);
    expect(await readOutbox(db)).toEqual([]);
    expect(unhandled).toEqual([]);
  });

  it("keep the profile, field by field, and clear one", async () => {
    expect(await readProfile(db)).toEqual({ formula: null, birthYear: null, heightCm: null });
    await recordChanges(db, [
      { kind: "profile", field: "formula", value: "male", at: AT },
      { kind: "profile", field: "height", value: 178, at: AT },
      { kind: "profile", field: "height", value: null, at: LATER },
    ]);
    expect(await readProfile(db)).toEqual({ formula: "male", birthYear: null, heightCm: null });
    expect(await readTarget(db)).toEqual({ minPct: 0.5, maxPct: 1 }); // a separate key
  });

  it("name a supplement creatine from its first name, keep it once removed, and tick its days", async () => {
    await recordChanges(db, [
      { kind: "supplement", id: S, field: "name", value: "Créatine", at: AT },
      { kind: "supplementLog", supplementId: S, date: "2026-10-06", taken: true, at: AT },
      { kind: "supplementLog", supplementId: S, date: "2026-10-07", taken: true, at: AT },
      { kind: "supplementLog", supplementId: S, date: "2026-10-07", taken: false, at: LATER },
      { kind: "supplement", id: S, field: "name", value: "Créa", at: LATER },
      { kind: "supplement", id: S, field: "removed", value: true, at: LATER },
    ]);
    expect(await readSupplements(db)).toEqual([
      { id: S, name: "Créa", nameAt: LATER, kind: "creatine", removed: true, removedAt: LATER },
    ]);
    expect((await readSupplementLogs(db)).map((l) => l.date)).toEqual(["2026-10-06"]);
  });

  it("keep an annotation as one block, and hide it once removed", async () => {
    await recordChange(db, {
      kind: "annotation",
      id: N,
      field: "fields",
      date: "2026-09-15",
      type: "diet_break",
      label: null,
      at: AT,
    });
    expect(await readAnnotations(db)).toEqual([
      {
        id: N,
        date: "2026-09-15",
        type: "diet_break",
        label: null,
        fieldsAt: AT,
        removed: false,
        removedAt: null,
      },
    ]);
    await recordChange(db, { kind: "annotation", id: N, field: "removed", value: true, at: LATER });
    expect(await readAnnotations(db)).toEqual([]);
  });

  it("count what waits as a person would", async () => {
    await recordChanges(db, [
      { kind: "weight", date: "2026-10-07", weightKg: 80, at: AT },
      { kind: "weight", date: "2026-10-07", weightKg: 79.8, at: LATER },
      { kind: "intake", date: "2026-10-07", field: "kcal", value: 2100, at: AT },
      { kind: "intake", date: "2026-10-07", field: "protein", value: 140, at: AT },
      { kind: "supplement", id: S, field: "name", value: "Fer", at: AT },
      { kind: "supplementLog", supplementId: S, date: "2026-10-07", taken: true, at: AT },
    ]);
    expect(await pendingCounts(db)).toEqual({ weighings: 1, total: 4 });
  });
});

describe("a server answer with the new tables", () => {
  beforeEach(open);

  it("takes their rows, and keeps a field entered meanwhile on top", async () => {
    await recordChange(db, {
      kind: "measure",
      date: "2026-10-06",
      field: "waist",
      value: 81.5,
      at: LATER,
    });
    await applyServer(
      db,
      [],
      server({
        measures: [
          {
            date: "2026-10-06",
            waistCm: 82,
            waistAt: AT,
            neckCm: 39,
            neckAt: AT,
            hipCm: null,
            hipAt: null,
          },
        ],
        intake: [{ date: "2026-10-07", kcal: 2100, kcalAt: AT, proteinG: 140, proteinAt: AT }],
        supplements: [
          {
            id: S,
            name: "Créatine",
            nameAt: AT,
            kind: "creatine",
            removed: false,
            removedAt: null,
          },
        ],
        supplementLogs: [{ supplementId: S, date: "2026-10-07", taken: true, at: AT }],
        annotations: [
          {
            id: N,
            date: "2026-09-15",
            type: "note",
            label: "voyage",
            fieldsAt: AT,
            removed: false,
            removedAt: null,
          },
        ],
        profile: {
          formula: "female",
          formulaAt: AT,
          birthYear: 1990,
          birthYearAt: AT,
          heightCm: 165,
          heightAt: AT,
        },
      }),
    );
    expect(await readMeasures(db)).toEqual([
      { date: "2026-10-06", waistCm: 81.5, neckCm: 39, hipCm: null },
    ]);
    expect(await readIntake(db)).toEqual([{ date: "2026-10-07", kcal: 2100, proteinG: 140 }]);
    expect((await readSupplements(db)).map((s) => s.name)).toEqual(["Créatine"]);
    expect(await readSupplementLogs(db)).toHaveLength(1);
    expect((await readAnnotations(db)).map((a) => a.label)).toEqual(["voyage"]);
    expect(await readProfile(db)).toEqual({ formula: "female", birthYear: 1990, heightCm: 165 });
  });

  it("takes back a refused tick, and shows the supplement as the server holds it", async () => {
    await recordChange(db, {
      kind: "supplementLog",
      supplementId: S,
      date: "2026-10-07",
      taken: true,
      at: AT,
    });
    await applyServer(
      db,
      await readOutbox(db),
      server({ rejected: [{ index: 0, reason: "unknown" }] }),
    );
    expect(await readSupplementLogs(db)).toEqual([]);
  });

  it("drops a supplement whose creation was refused, and clears a refused measurement", async () => {
    await recordChanges(db, [
      { kind: "supplement", id: S, field: "name", value: "Zinc", at: AT },
      { kind: "measure", date: "2026-10-06", field: "hip", value: 98, at: AT },
    ]);
    await applyServer(
      db,
      await readOutbox(db),
      server({
        rejected: [
          { index: 0, reason: "unknown" },
          { index: 1, reason: "refused" },
        ],
      }),
    );
    expect(await readSupplements(db)).toEqual([]);
    expect(await readMeasures(db)).toEqual([]);
  });

  it("takes back two refused measurements of one day, none left on screen", async () => {
    await recordChanges(db, [
      { kind: "measure", date: "2026-10-06", field: "waist", value: 82, at: AT },
      { kind: "measure", date: "2026-10-06", field: "neck", value: 39, at: AT },
    ]);
    await applyServer(
      db,
      await readOutbox(db),
      server({
        rejected: [
          { index: 0, reason: "refused" },
          { index: 1, reason: "refused" },
        ],
      }),
    );
    expect(await readMeasures(db)).toEqual([]);
  });
});
