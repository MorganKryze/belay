import type {
  Change,
  ProgramRow,
  ProgramSessionRow,
  ProgramSlotRow,
} from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import {
  DEFAULT_SCHEDULE,
  rotationOf,
  SEED,
  SEED_PROGRAM_ID,
  seedId,
} from "@belay/shared/training/stored-program";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answer } from "@/test/answer";
import { fakeApi } from "@/test/fake-api";
import {
  accountDbName,
  type AccountDb,
  applyServer,
  openAccountDb,
  readActivities,
  readCursor,
  readHistory,
  readOutbox,
  readPrograms,
  readRejected,
  readWeights,
  recordChange,
  recordChanges,
  startWorkout,
} from "./db";
import { createSyncEngine } from "./engine";
import { postSync } from "./transport";

const AT = "2026-10-07T17:00:00.000Z";
const LATER = "2026-10-07T17:05:00.000Z";
const LATEST = "2026-10-07T17:10:00.000Z";
const A = seedId(1); // the starting program's session A
const BENCH = seedId(0x101); // session A's first slot: bench press, 6 to 8 reps, 2 warm-ups
const P2 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d80";
const S2 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d81";
const SLOT2 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d82";
const W = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const PLAN = [...sessionByCode("A", starterProgram)!.slots];

// The server's copy of a starting row: seeded with every field unwritten.
const benchRow = (patch: Partial<ProgramSlotRow> = {}): ProgramSlotRow => {
  const { measure, ...slot } = SEED.slots.find((s) => s.id === BENCH)!;
  return {
    ...slot,
    repRange: [...slot.repRange] as [number, number],
    rirTarget: [...slot.rirTarget] as [number, number],
    measure: measure ?? null,
    positionAt: null,
    exerciseAt: null,
    repsAt: null,
    setsAt: null,
    rirAt: null,
    restAt: null,
    warmupsAt: null,
    mainAt: null,
    groupAt: null,
    ruleAt: null,
    removedAt: null,
    ...patch,
  };
};
const sessionRow = (patch: Partial<ProgramSessionRow> = {}): ProgramSessionRow => ({
  id: A,
  name: null,
  nameAt: null,
  programId: SEED_PROGRAM_ID,
  position: 0,
  placeAt: null,
  removed: false,
  removedAt: null,
  ...patch,
});

const rename = (name: string, at = AT): Change => ({
  kind: "programSession",
  id: A,
  field: "name",
  value: name,
  at,
});
const removeA = (at = AT): Change => ({
  kind: "programSession",
  id: A,
  field: "removed",
  value: true,
  at,
});
// A second program with one session of one slot (a plank held 30 to 60 s).
const secondProgram: Change[] = [
  { kind: "program", id: P2, field: "create", name: "Été", schedule: DEFAULT_SCHEDULE, at: AT },
  {
    kind: "programSession",
    id: S2,
    field: "create",
    name: null,
    programId: P2,
    position: 0,
    at: AT,
  },
  {
    kind: "programSlot",
    id: SLOT2,
    field: "create",
    sessionId: S2,
    position: 0,
    rule: null,
    exerciseId: "ds:2135",
    measure: "seconds",
    sets: 3,
    repRange: [30, 60],
    rirTarget: [1, 2],
    restSec: 60,
    warmupSets: 0,
    isMain: false,
    groupKey: null,
    at: AT,
  },
];
const sessionA = async (db: AccountDb) =>
  (await readPrograms(db)).sessions.find((s) => s.id === A)!;
const bench = async (db: AccountDb) => (await readPrograms(db)).slots.find((s) => s.id === BENCH)!;

beforeEach(() => {
  indexedDB = new IDBFactory(); // a fresh device for every test
});
afterEach(() => vi.unstubAllGlobals());

describe("the upgrade from version 4", () => {
  it("keeps weigh-ins, sessions, sets, activities and the queue, and pulls everything again", async () => {
    // The database as the version before programs left it.
    const v4 = await openDB(accountDbName("user-a"), 4, {
      upgrade(db) {
        for (const name of ["profile", "meta", "activeSession"]) db.createObjectStore(name);
        for (const name of ["weights", "measures", "intake", "steps"])
          db.createObjectStore(name, { keyPath: "date" });
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("rejected", { keyPath: "id", autoIncrement: true });
        for (const name of ["supplements", "annotations", "workouts", "activities"])
          db.createObjectStore(name, { keyPath: "id" });
        db.createObjectStore("supplementLogs", { keyPath: ["supplementId", "date"] });
        db.createObjectStore("sets", { keyPath: "id" }).createIndex("workoutId", "workoutId");
      },
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
      },
    });
    const workout = {
      id: W,
      sessionCode: "A",
      plan: PLAN,
      planAt: null,
      startedAt: AT,
      startedAtAt: null,
      endedAt: LATER,
      endedAtAt: LATER,
      note: null,
      noteAt: null,
      exerciseNotes: {},
      exerciseNotesAt: null,
      removed: false,
      removedAt: null,
    };
    const set = {
      id: SLOT2,
      workoutId: W,
      slotIndex: 0,
      position: 3,
      exerciseId: "ds:0025",
      warmup: false,
      weightKg: 80,
      reps: 8,
      seconds: null,
      rir: 1,
      doneAt: LATER,
      fieldsAt: LATER,
      removed: false,
      removedAt: null,
    };
    const activity = {
      id: S2,
      date: "2026-10-07",
      type: "climbing" as const,
      durationMin: 90,
      cardioType: null,
      climbStyle: null,
      climbRuns: null,
      climbGrade: null,
      climbColor: null,
      fieldsAt: AT,
      removed: false,
      removedAt: null,
    };
    const queued: Change = { kind: "weight", date: "2026-10-07", weightKg: 79.8, at: AT };
    await v4.put("weights", { date: "2026-10-07", weightKg: 79.8, at: AT });
    await v4.put("workouts", workout);
    await v4.put("sets", set);
    await v4.put("activities", activity);
    await v4.add("outbox", { change: queued });
    await v4.add("rejected", { change: queued, reason: "refused" });
    await v4.put("meta", "40", "cursor");

    const db = await openAccountDb("user-a");
    expect(db.version).toBe(5);
    expect(await readWeights(db)).toEqual([{ date: "2026-10-07", weightKg: 79.8 }]);
    expect(await readHistory(db)).toEqual({ workouts: [workout], sets: [set] });
    expect((await readActivities(db)).map((a) => a.id)).toEqual([S2]);
    expect((await readRejected(db)).map((r) => r.reason)).toEqual(["refused"]);
    // That version dropped program rows and the session each workout came from: the cursor goes
    // back to the start so the next sync fetches them.
    expect(await readCursor(db)).toBe("0");
    expect(await readPrograms(db)).toEqual(SEED);
    // The queue goes on from where it was.
    await recordChange(db, rename("Poussée"));
    expect((await readOutbox(db)).map((e) => [e.id, e.change.kind])).toEqual([
      [1, "weight"],
      [2, "programSession"],
    ]);
    db.close();
  });
});

describe("programs on the phone", () => {
  let db: AccountDb;
  beforeEach(async () => {
    db = await openAccountDb("user-a");
  });

  it("reads an empty store as the active starting program", async () => {
    const stored = await readPrograms(db);
    expect(stored).toEqual(SEED);
    expect(rotationOf(stored).map((t) => [t.code, t.sessionId])).toEqual([
      ["A", A],
      ["B", seedId(2)],
      ["C", seedId(3)],
    ]);
  });

  it("stores an edit and queues it in one transaction", async () => {
    await recordChanges(db, [
      rename("Poussée"),
      { kind: "programSlot", id: BENCH, field: "sets", value: 5, at: AT },
    ]);
    expect((await sessionA(db)).name).toBe("Poussée");
    expect((await bench(db)).sets).toBe(5);
    expect((await readOutbox(db)).map((e) => e.change)).toEqual([
      rename("Poussée"),
      { kind: "programSlot", id: BENCH, field: "sets", value: 5, at: AT },
    ]);
    // A rep range written in seconds on a slot counted in reps would be read in the wrong unit:
    // the whole batch is refused, the rename with it.
    await expect(
      recordChanges(db, [
        rename("Haut du corps", LATER),
        {
          kind: "programSlot",
          id: BENCH,
          field: "reps",
          value: [30, 45],
          measure: "seconds",
          at: LATER,
        },
      ]),
    ).rejects.toThrow(RangeError);
    expect((await sessionA(db)).name).toBe("Poussée");
    expect((await bench(db)).repRange).toEqual([6, 8]);
    expect(await readOutbox(db)).toHaveLength(2);
  });

  it("keeps an edit made with no session, queued for the next sign-in", async () => {
    fakeApi({ me: null }); // the session expired: the server answers 401
    await recordChange(db, removeA());
    const engine = createSyncEngine({ userId: "user-a", db, send: postSync, onApplied: () => {} });
    await engine.sync();
    expect(engine.status()).toBe("expired");
    expect((await sessionA(db)).removed).toBe(true);
    expect((await readOutbox(db)).map((e) => e.change)).toEqual([removeA()]);
  });

  it("reverts a refused change unless it was edited again", async () => {
    await recordChanges(db, [removeA(), ...secondProgram]);
    const sent = await readOutbox(db);
    await applyServer(
      db,
      sent,
      answer({
        rejected: [
          { index: 0, reason: "refused" },
          { index: 1, reason: "refused" },
          { index: 2, reason: "unknown" },
          { index: 3, reason: "unknown" },
        ],
      }),
    );
    expect((await sessionA(db)).removed).toBe(false);
    expect(await readPrograms(db)).toEqual(SEED); // the second program and its rows are gone
    expect((await readRejected(db)).map((r) => r.change.kind)).toEqual([
      "programSession",
      "program",
      "programSession",
      "programSlot",
    ]);

    // Removed again while the first removal was out: the refusal leaves the later one.
    await recordChange(db, removeA(LATER));
    const out = await readOutbox(db);
    await recordChange(db, removeA(LATEST));
    await applyServer(db, out, answer({ rejected: [{ index: 0, reason: "refused" }] }));
    expect((await sessionA(db)).removed).toBe(true);
  });

  it("takes the server's program rows and leaves everything as it was when it sends none", async () => {
    const program: ProgramRow = {
      id: P2,
      name: "Été",
      nameAt: AT,
      schedule: { mode: "rotation", days: Array(7).fill(null) },
      scheduleAt: AT,
      removed: false,
      removedAt: null,
    };
    await applyServer(
      db,
      [],
      answer({
        programs: [program],
        programSessions: [sessionRow({ id: S2, programId: P2, placeAt: AT })],
        programSlots: [benchRow({ id: SLOT2, sessionId: S2, positionAt: AT })],
        activeProgram: { programId: P2, at: AT },
      }),
    );
    const stored = await readPrograms(db);
    expect(stored.activeId).toBe(P2);
    expect(stored.activeAt).toBe(AT);
    expect(stored.programs.map((p) => p.id)).toEqual([SEED_PROGRAM_ID, P2]);
    expect(rotationOf(stored).map((t) => [t.code, t.sessionId])).toEqual([["A", S2]]);

    await applyServer(db, [], answer({ cursor: "2" })); // an older server, or nothing new
    expect(await readPrograms(db)).toEqual(stored);
  });

  it("keeps a queued edit shown over an older server row, field by field", async () => {
    await recordChanges(db, [
      rename("Poussée", LATER),
      { kind: "programSlot", id: BENCH, field: "sets", value: 5, at: LATER },
    ]);
    // Another device renamed the session and changed the rest earlier; this phone's edits were
    // made while that answer was on its way.
    await applyServer(
      db,
      [],
      answer({
        programSessions: [sessionRow({ name: "Push", nameAt: AT })],
        programSlots: [benchRow({ sets: 3, setsAt: AT, restSec: 180, restAt: AT })],
      }),
    );
    expect((await sessionA(db)).name).toBe("Poussée");
    expect(await bench(db)).toMatchObject({ sets: 5, restSec: 180 });
    // A newer server write wins over the queued one.
    await applyServer(
      db,
      [],
      answer({ programSessions: [sessionRow({ name: "Push", nameAt: LATEST })] }),
    );
    expect((await sessionA(db)).name).toBe("Push");
  });

  it("drops a queued rep range or warm-ups written for another measure than the server row's", async () => {
    await recordChanges(db, [
      { kind: "programSlot", id: BENCH, field: "reps", value: [8, 10], measure: null, at: LATER },
      { kind: "programSlot", id: BENCH, field: "warmups", value: 1, measure: null, at: LATER },
    ]);
    expect(await bench(db)).toMatchObject({ repRange: [8, 10], warmupSets: 1 });
    // Another device replaced the exercise by a timed one before: the range and warm-ups queued
    // here are in repetitions and newer, yet never land on a slot counted in seconds.
    const timed = benchRow({
      exerciseId: "ds:2135",
      measure: "seconds",
      exerciseAt: AT,
      repRange: [30, 60],
      repsAt: AT,
      warmupSets: 0,
      warmupsAt: AT,
    });
    await applyServer(db, [], answer({ programSlots: [timed] }));
    expect(await bench(db)).toMatchObject({
      exerciseId: "ds:2135",
      measure: "seconds",
      repRange: [30, 60],
      warmupSets: 0,
    });
    // The server refuses both (wrong_measure) and sends the row back: it stays.
    await applyServer(
      db,
      await readOutbox(db),
      answer({
        rejected: [
          { index: 0, reason: "wrong_measure" },
          { index: 1, reason: "wrong_measure" },
        ],
        programSlots: [timed],
      }),
    );
    expect(await bench(db)).toMatchObject({
      measure: "seconds",
      repRange: [30, 60],
      warmupSets: 0,
    });
    expect(await readOutbox(db)).toEqual([]);
  });

  it("changes the rotation read and nothing else when the active program switches", async () => {
    await recordChanges(db, secondProgram);
    const before = await readPrograms(db);
    expect(rotationOf(before).map((t) => t.sessionId)).toEqual([A, seedId(2), seedId(3)]);
    await recordChange(db, { kind: "activeProgram", programId: P2, at: LATER });
    const after = await readPrograms(db);
    expect(after).toEqual({ ...before, activeId: P2, activeAt: LATER });
    expect(rotationOf(after).map((t) => [t.code, t.sessionId])).toEqual([["A", S2]]);
    expect((await readOutbox(db)).at(-1)!.change).toEqual({
      kind: "activeProgram",
      programId: P2,
      at: LATER,
    });
  });

  it("records the session a start came from, and a start without one as before", async () => {
    const start = {
      kind: "workout" as const,
      id: W,
      field: "start" as const,
      sessionCode: "A",
      plan: PLAN,
      startedAt: AT,
      at: AT,
    };
    await startWorkout(db, { ...start, sessionId: A });
    const [workout] = (await readHistory(db)).workouts;
    expect(workout!.sessionId).toBe(A);
    expect((await readOutbox(db)).map((e) => e.change)).toEqual([{ ...start, sessionId: A }]);

    const other = await openAccountDb("user-b");
    await startWorkout(other, start);
    expect("sessionId" in (await readHistory(other)).workouts[0]!).toBe(false);
    other.close();
  });
});
