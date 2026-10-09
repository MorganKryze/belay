import type { Change, SetRow, WorkoutRow } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { liveSets } from "@belay/shared/training/rules";
import { IDBFactory } from "fake-indexeddb";
import { openDB } from "idb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answer } from "@/test/answer";
import {
  accountDbName,
  type AccountDb,
  type ActiveSession,
  applyServer,
  closeForgotten,
  openAccountDb,
  pendingCounts,
  readActiveSession,
  readCursor,
  readHistory,
  readIntake,
  readOutbox,
  readRejected,
  readWeights,
  recordChanges,
  recordSet,
  type SetInput,
  startWorkout,
} from "./db";
import { createSyncEngine, type Send } from "./engine";

const AT = "2026-10-07T17:00:00.000Z";
const LATER = "2026-10-07T17:05:00.000Z";
const LATEST = "2026-10-07T17:10:00.000Z";
const W = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const S1 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
const S2 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d92";
const PLAN = [...sessionByCode("A")!.slots];

const start = (id = W, at = AT): Change => ({
  kind: "workout",
  id,
  field: "start",
  sessionCode: "A",
  plan: PLAN,
  startedAt: at,
  at,
});
const input = (id: string, position = 3, patch: Partial<SetInput> = {}): SetInput => ({
  id,
  workoutId: W,
  slotIndex: 0,
  position,
  exerciseId: "ds:0025",
  warmup: false,
  weightKg: 82.5,
  reps: 8,
  rir: 1,
  doneAt: LATER,
  ...patch,
});
const active = (restEndsAt: string | null = null): ActiveSession => ({
  workoutId: W,
  slotIndex: 0,
  restEndsAt,
});
const workoutRow = (patch: Partial<WorkoutRow> = {}): WorkoutRow => ({
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
  ...patch,
});
const setRow = (id: string, patch: Partial<SetRow> = {}): SetRow => ({
  ...input(id),
  fieldsAt: LATER,
  removed: false,
  removedAt: null,
  ...patch,
});

beforeEach(() => {
  indexedDB = new IDBFactory(); // a fresh device for every test
});

describe("the upgrade from version 2", () => {
  it("keeps every entry, the queue, the refused list and the cursor", async () => {
    // The database as M2b left it.
    const v2 = await openDB(accountDbName("user-a"), 2, {
      upgrade(db) {
        db.createObjectStore("weights", { keyPath: "date" });
        db.createObjectStore("profile");
        db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("meta");
        db.createObjectStore("rejected", { keyPath: "id", autoIncrement: true });
        db.createObjectStore("measures", { keyPath: "date" });
        db.createObjectStore("intake", { keyPath: "date" });
        db.createObjectStore("supplements", { keyPath: "id" });
        db.createObjectStore("supplementLogs", { keyPath: ["supplementId", "date"] });
        db.createObjectStore("annotations", { keyPath: "id" });
      },
      blocking(_current, _blocked, event) {
        (event.target as IDBDatabase).close();
      },
    });
    const queued: Change = { kind: "weight", date: "2026-10-07", weightKg: 79.8, at: AT };
    await v2.put("weights", { date: "2026-10-07", weightKg: 79.8, at: AT });
    await v2.put("intake", {
      date: "2026-10-07",
      kcal: 2100,
      kcalAt: AT,
      proteinG: null,
      proteinAt: null,
    });
    await v2.add("outbox", { change: queued });
    await v2.add("rejected", { change: queued, reason: "refused" });
    await v2.put("meta", "12", "cursor");

    const db = await openAccountDb("user-a");
    expect(db.version).toBe(3);
    expect(await readWeights(db)).toEqual([{ date: "2026-10-07", weightKg: 79.8 }]);
    expect(await readIntake(db)).toEqual([{ date: "2026-10-07", kcal: 2100, proteinG: null }]);
    expect((await readRejected(db)).map((r) => r.reason)).toEqual(["refused"]);
    expect(await readCursor(db)).toBe("12");
    // The session stores are there, and the queue goes on from where it was.
    await recordChanges(db, [start()], { active: active() });
    expect((await readOutbox(db)).map((e) => [e.id, e.change.kind])).toEqual([
      [1, "weight"],
      [2, "workout"],
    ]);
    expect(await readActiveSession(db)).toEqual(active());
    db.close();
  });
});

let db: AccountDb;
const open = async () => {
  db = await openAccountDb("user-a");
};

describe("a session on the phone", () => {
  beforeEach(open);

  it("keeps a started session, each validated set, and the open session with them", async () => {
    await recordChanges(db, [start()], { active: active() });
    await recordSet(db, input(S1), LATER, active("2026-10-07T17:07:30.000Z"));
    const history = await readHistory(db);
    expect(history.workouts).toEqual([workoutRow()]);
    expect(history.sets).toEqual([setRow(S1)]);
    expect(await readActiveSession(db)).toEqual(active("2026-10-07T17:07:30.000Z"));
    expect((await readOutbox(db)).map((e) => e.change.kind)).toEqual(["workout", "set"]);
    expect(await pendingCounts(db)).toEqual({ weighings: 0, total: 1 });
  });

  it("corrects a set already validated at that place (another tab), never doubles it", async () => {
    await recordChanges(db, [start()], { active: active() });
    await recordSet(db, input(S1), LATER, active());
    // A second tab, still showing the set as not done, validates it again.
    await recordSet(db, input(S2, 3, { reps: 7, rir: 0 }), LATEST, active());
    const { sets } = await readHistory(db);
    expect(sets).toEqual([setRow(S1, { reps: 7, rir: 0, fieldsAt: LATEST })]);
    expect((await readOutbox(db)).map((e) => e.change)).toContainEqual(
      expect.objectContaining({ kind: "set", id: S1, field: "values", reps: 7 }),
    );
  });

  it("writes nothing of a set it refuses, not even the open session", async () => {
    await recordChanges(db, [start()], { active: active() });
    await expect(
      recordSet(db, input(S1, 3, { weightKg: 80.1 }), LATER, active(LATEST)),
    ).rejects.toThrow(RangeError);
    expect((await readHistory(db)).sets).toEqual([]);
    expect(await readActiveSession(db)).toEqual(active());
  });

  it("takes the server's sessions and sets, and keeps a later correction made meanwhile", async () => {
    await recordChanges(db, [start()]);
    await recordSet(db, input(S1), LATER, active());
    const sent = await readOutbox(db);
    await recordSet(db, input(S2, 3, { reps: 6 }), LATEST, active()); // while the request is out
    await applyServer(
      db,
      sent,
      answer({ cursor: "9", workouts: [workoutRow()], sets: [setRow(S1)] }),
    );
    expect((await readHistory(db)).sets).toEqual([setRow(S1, { reps: 6, fieldsAt: LATEST })]);
    expect(await readCursor(db)).toBe("9");
  });

  it("lets go of the open session once another device finished or removed it", async () => {
    await recordChanges(db, [start()], { active: active() });
    await applyServer(
      db,
      await readOutbox(db),
      answer({ workouts: [workoutRow({ endedAt: LATER, endedAtAt: LATER })] }),
    );
    expect(await readActiveSession(db)).toBeNull();
  });

  it("takes back a refused start and a refused set", async () => {
    await recordChanges(db, [start()], { active: active() });
    await recordSet(db, input(S1), LATER, active());
    const sent = await readOutbox(db);
    await applyServer(
      db,
      sent,
      answer({
        rejected: [
          { index: 0, reason: "refused" },
          { index: 1, reason: "unknown_exercise" },
        ],
      }),
    );
    expect(await readHistory(db)).toEqual({ workouts: [], sets: [] });
    expect(await readActiveSession(db)).toBeNull();
    expect((await readRejected(db)).map((r) => r.reason)).toEqual(["refused", "unknown_exercise"]);
  });

  it("leaves a removed session's sets in place, for the shared rules to leave out", async () => {
    await recordChanges(db, [start()]);
    await recordSet(db, input(S1), LATER, active());
    await recordChanges(db, [
      { kind: "workout", id: W, field: "removed", value: true, at: LATEST },
    ]);
    const history = await readHistory(db);
    expect(history.sets).toHaveLength(1);
    expect(liveSets(history)).toEqual([]);
  });

  it("sends a set validated offline once the network is back", async () => {
    let online = false;
    const send = vi.fn<Send>(async (request) =>
      online
        ? { kind: "ok", response: answer({ cursor: String(request.changes.length) }) }
        : { kind: "offline" },
    );
    const engine = createSyncEngine({ userId: "user-a", db, send, onApplied: () => {} });
    await recordChanges(db, [start()], { active: active() });
    await recordSet(db, input(S1), LATER, active());
    await engine.sync();
    expect(engine.status()).toBe("offline");
    expect(await readOutbox(db)).toHaveLength(2);
    online = true;
    await engine.sync();
    expect(send.mock.calls.at(-1)?.[0].changes.map((c) => c.kind)).toEqual(["workout", "set"]);
    expect(await readOutbox(db)).toEqual([]);
    expect((await readHistory(db)).sets).toHaveLength(1);
  });
});

describe("closeForgotten (D12)", () => {
  beforeEach(open);

  it("ends a session at its last set once that set is more than 6 hours old", async () => {
    await recordChanges(db, [start()], { active: active() });
    await recordSet(db, input(S1), LATER, active());
    expect(await closeForgotten(db, new Date("2026-10-07T23:04:00.000Z"))).toBe(false);
    expect(await closeForgotten(db, new Date("2026-10-07T23:06:00.000Z"))).toBe(true);
    const [w] = (await readHistory(db)).workouts;
    expect(w).toMatchObject({ endedAt: LATER, endedAtAt: "2026-10-07T23:06:00.000Z" });
    expect(await readActiveSession(db)).toBeNull();
  });

  it("removes a session without a set after 6 hours, and leaves a finished one alone", async () => {
    const other = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d93";
    await recordChanges(
      db,
      [
        start(),
        start(other, "2026-10-05T17:00:00.000Z"),
        { kind: "workout", id: other, field: "ended", value: "2026-10-05T18:00:00.000Z", at: AT },
      ],
      { active: active() },
    );
    expect(await closeForgotten(db, new Date("2026-10-07T23:01:00.000Z"))).toBe(true);
    const workouts = (await readHistory(db)).workouts;
    expect(workouts.find((w) => w.id === W)?.removed).toBe(true);
    expect(workouts.find((w) => w.id === other)?.removed).toBe(false);
  });

  it("never removes a session this device does not hold: its sets may not have arrived", async () => {
    await recordChanges(db, [start()]); // pulled from another device: no active session here
    expect(await closeForgotten(db, new Date("2026-10-08T00:30:00.000Z"))).toBe(false);
    expect((await readHistory(db)).workouts[0]?.removed).toBe(false);
  });

  it("still ends another device's session at the last set it knows", async () => {
    await recordChanges(db, [start()]);
    await recordSet(db, input(S1), LATER, active());
    await recordChanges(db, [], { active: null });
    expect(await closeForgotten(db, new Date("2026-10-08T00:30:00.000Z"))).toBe(true);
    expect((await readHistory(db)).workouts[0]).toMatchObject({ endedAt: LATER });
  });
});

describe("startWorkout leaving a forgotten session", () => {
  beforeEach(open);
  const NEW = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d94";
  const begin = () => start(NEW, "2026-10-09T08:00:00.000Z") as Parameters<typeof startWorkout>[1];

  it("ends it at its last set, in the same go as the new start", async () => {
    await recordChanges(db, [start()]);
    await recordSet(db, input(S1), LATER, active());
    expect(await startWorkout(db, begin())).toBe(NEW);
    const workouts = (await readHistory(db)).workouts;
    expect(workouts.find((w) => w.id === W)).toMatchObject({ endedAt: LATER });
    expect(workouts.find((w) => w.id === NEW)?.endedAt).toBeNull();
    expect((await readActiveSession(db))?.workoutId).toBe(NEW);
  });

  it("removes it when it has no set and is this device's own", async () => {
    await recordChanges(db, [start()], { active: active() });
    await startWorkout(db, begin());
    expect((await readHistory(db)).workouts.find((w) => w.id === W)?.removed).toBe(true);
  });

  it("leaves another device's set-less session alone", async () => {
    await recordChanges(db, [start()]);
    await startWorkout(db, begin());
    expect((await readHistory(db)).workouts.find((w) => w.id === W)?.removed).toBe(false);
  });
});

describe("closeForgotten waits for a sync that landed", () => {
  beforeEach(open);
  const NOW = new Date("2026-10-08T00:30:00.000Z"); // 7.5 h after the start
  const engineWith = (send: Send) =>
    createSyncEngine({
      userId: "user-a",
      db,
      send,
      onApplied: () => {},
      onSynced: async () => void (await closeForgotten(db, NOW)),
    });
  const removedAfter = async () => (await readHistory(db)).workouts[0]?.removed;

  it("keeps a session open while offline, then removes it once a sync brings nothing newer", async () => {
    await recordChanges(db, [start()], { active: active() });
    let online = false;
    const engine = engineWith(async () =>
      online
        ? { kind: "ok", response: answer({ cursor: "1", workouts: [workoutRow()] }) }
        : { kind: "offline" },
    );
    await engine.sync();
    expect(await removedAfter()).toBe(false);
    online = true;
    await engine.sync();
    expect(await removedAfter()).toBe(true);
  });

  it("keeps the session when the sync brings a set done an hour ago on another device", async () => {
    await recordChanges(db, [start()], { active: active() });
    const recent = "2026-10-07T23:30:00.000Z";
    const engine = engineWith(async () => ({
      kind: "ok",
      response: answer({
        cursor: "1",
        workouts: [workoutRow()],
        sets: [setRow(S1, { doneAt: recent, fieldsAt: recent })],
      }),
    }));
    await engine.sync();
    expect(await removedAfter()).toBe(false);
    expect(await readActiveSession(db)).toEqual(active());
  });
});
