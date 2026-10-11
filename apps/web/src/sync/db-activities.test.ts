import type { ActivityRow, Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it } from "vitest";
import { answer } from "@/test/answer";
import {
  accountDbName,
  type AccountDb,
  applyServer,
  openAccountDb,
  pendingCounts,
  readActiveSession,
  readActivities,
  readCursor,
  readHistory,
  readOutbox,
  readRejected,
  readSteps,
  recordChanges,
} from "./db";

const AT = "2026-10-07T17:00:00.000Z";
const LATER = "2026-10-07T17:05:00.000Z";
const LATEST = "2026-10-07T17:10:00.000Z";
const W = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const S1 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
const A1 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7da1";
const A2 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7da2";
const PLAN = [...sessionByCode("A")!.slots];

const steps = (value: number | null, at = AT, date = "2026-10-07"): Change => ({
  kind: "steps",
  date,
  value,
  at,
});
const climb = (id: string, at = AT, patch: Record<string, unknown> = {}): Change =>
  ({
    kind: "activity",
    id,
    field: "fields",
    date: "2026-10-07",
    type: "climbing",
    durationMin: 90,
    cardioType: null,
    climbStyle: "boulder",
    climbRuns: 14,
    climbGrade: "6b+",
    climbColor: null,
    at,
    ...patch,
  }) as Change;
const climbRow = (id: string, patch: Partial<ActivityRow> = {}): ActivityRow => ({
  id,
  date: "2026-10-07",
  type: "climbing",
  durationMin: 90,
  cardioType: null,
  climbStyle: "boulder",
  climbRuns: 14,
  climbGrade: "6b+",
  climbColor: null,
  fieldsAt: AT,
  removed: false,
  removedAt: null,
  ...patch,
});

beforeEach(() => {
  indexedDB = new IDBFactory(); // a fresh device for every test
});

describe("the upgrade from version 3", () => {
  it("keeps every session, set, open session and queued change, and adds the new fields", async () => {
    // The database as M3a left it, held open by a tab running M3a's code.
    let closedForUpgrade = false;
    const v3 = await openDB(accountDbName("user-a"), 3, {
      upgrade(db) {
        for (const name of ["profile", "meta", "activeSession"]) db.createObjectStore(name);
        db.createObjectStore("weights", { keyPath: "date" });
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("rejected", { keyPath: "id", autoIncrement: true });
        for (const name of ["measures", "intake"]) db.createObjectStore(name, { keyPath: "date" });
        for (const name of ["supplements", "annotations", "workouts"])
          db.createObjectStore(name, { keyPath: "id" });
        db.createObjectStore("supplementLogs", { keyPath: ["supplementId", "date"] });
        db.createObjectStore("sets", { keyPath: "id" }).createIndex("workoutId", "workoutId");
      },
      blocking(_current, _blocked, event) {
        closedForUpgrade = true;
        (event.target as IDBDatabase).close();
      },
    });
    const workout = {
      id: W,
      sessionCode: "A",
      plan: PLAN,
      startedAt: AT,
      endedAt: null,
      endedAtAt: null,
      note: null,
      noteAt: null,
      exerciseNotes: {},
      exerciseNotesAt: null,
      removed: false,
      removedAt: null,
    };
    const set = {
      id: S1,
      workoutId: W,
      slotIndex: 0,
      position: 3,
      exerciseId: "ds:0025",
      warmup: false,
      weightKg: 80,
      reps: 8,
      rir: 1,
      doneAt: LATER,
      fieldsAt: LATER,
      removed: false,
      removedAt: null,
    };
    // A set validated offline under M3a: in the queue without seconds.
    const queued: Change = {
      kind: "set",
      id: S1,
      workoutId: W,
      field: "create",
      slotIndex: 0,
      position: 3,
      exerciseId: "ds:0025",
      warmup: false,
      weightKg: 80,
      reps: 8,
      rir: 1,
      doneAt: LATER,
      at: LATER,
    };
    await v3.put("workouts", workout);
    await v3.put("sets", set);
    await v3.put("activeSession", { workoutId: W, slotIndex: 0, restEndsAt: null }, "current");
    await v3.add("outbox", { change: queued });
    await v3.put("meta", "40", "cursor");

    const db = await openAccountDb("user-a");
    expect(closedForUpgrade).toBe(true);
    expect(db.version).toBe(4);
    expect(await readHistory(db)).toEqual({
      workouts: [{ ...workout, planAt: null, startedAtAt: null }],
      sets: [{ ...set, seconds: null }],
    });
    expect(await readActiveSession(db)).toEqual({ workoutId: W, slotIndex: 0, restEndsAt: null });
    expect(await readCursor(db)).toBe("40");
    // The new stores are there, and the queue goes on from where it was.
    await recordChanges(db, [steps(8400)]);
    expect((await readOutbox(db)).map((e) => [e.id, e.change.kind])).toEqual([
      [1, "set"],
      [2, "steps"],
    ]);
    expect(await readSteps(db)).toEqual([{ date: "2026-10-07", steps: 8400 }]);
    db.close();
  });
});

let db: AccountDb;
describe("steps and activities on the phone", () => {
  beforeEach(async () => {
    db = await openAccountDb("user-a");
  });

  it("keeps the day's steps, a correction, and a deletion", async () => {
    await recordChanges(db, [steps(8400), steps(8437, LATER), steps(3000, AT, "2026-10-06")]);
    expect(await readSteps(db)).toEqual([
      { date: "2026-10-06", steps: 3000 },
      { date: "2026-10-07", steps: 8437 },
    ]);
    await recordChanges(db, [steps(null, LATEST)]);
    expect(await readSteps(db)).toEqual([{ date: "2026-10-06", steps: 3000 }]);
    expect(await pendingCounts(db)).toEqual({ weighings: 0, total: 2 });
  });

  it("keeps several activities of a day, an edit, and a removal", async () => {
    const bike = climb(A2, AT, {
      type: "cardio",
      durationMin: 45,
      cardioType: "bike",
      climbStyle: null,
      climbRuns: null,
      climbGrade: null,
    });
    await recordChanges(db, [climb(A1), bike]);
    expect((await readActivities(db)).map((a) => [a.id, a.kind, a.durationMin])).toEqual([
      [A1, "climbing", 90],
      [A2, "cardio", 45],
    ]);
    await recordChanges(db, [
      climb(A1, LATER, { climbGrade: null, climbColor: "blue" }),
      { kind: "activity", id: A2, field: "removed", value: true, at: LATER },
    ]);
    expect(await readActivities(db)).toEqual([
      {
        id: A1,
        date: "2026-10-07",
        kind: "climbing",
        durationMin: 90,
        cardioType: null,
        climbStyle: "boulder",
        climbRuns: 14,
        climbGrade: null,
        climbColor: "blue",
        removed: false,
      },
    ]);
  });

  it("takes the server's rows, and keeps a later edit made meanwhile", async () => {
    await recordChanges(db, [climb(A1)]);
    const sent = await readOutbox(db);
    await recordChanges(db, [climb(A1, LATEST, { durationMin: 120 })]); // while the request is out
    await applyServer(
      db,
      sent,
      answer({
        cursor: "7",
        activities: [climbRow(A1), climbRow(A2, { date: "2026-10-05" })],
        steps: [{ date: "2026-10-06", steps: 5000, stepsAt: AT }],
      }),
    );
    expect((await readActivities(db)).map((a) => [a.id, a.durationMin])).toEqual([
      [A2, 90],
      [A1, 120],
    ]);
    expect(await readSteps(db)).toEqual([{ date: "2026-10-06", steps: 5000 }]);
  });

  it("takes back a refused activity and refused steps, and keeps a trace of each", async () => {
    await recordChanges(db, [climb(A1), steps(8400)]);
    await applyServer(
      db,
      await readOutbox(db),
      answer({
        rejected: [
          { index: 0, reason: "refused" },
          { index: 1, reason: "refused" },
        ],
      }),
    );
    expect(await readActivities(db)).toEqual([]);
    expect(await readSteps(db)).toEqual([]);
    expect((await readRejected(db)).map((r) => r.change.kind)).toEqual(["activity", "steps"]);
  });

  it("puts a refused removal back", async () => {
    await recordChanges(db, [climb(A1)]);
    await applyServer(db, await readOutbox(db), answer({ activities: [climbRow(A1)] }));
    await recordChanges(db, [
      { kind: "activity", id: A1, field: "removed", value: true, at: LATER },
    ]);
    expect(await readActivities(db)).toEqual([]);
    await applyServer(
      db,
      await readOutbox(db),
      answer({ rejected: [{ index: 0, reason: "refused" }] }),
    );
    expect((await readActivities(db)).map((a) => a.id)).toEqual([A1]);
  });
});
