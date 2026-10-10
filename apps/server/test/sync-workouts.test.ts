import { newId } from "@belay/shared";
import type { Change, SetRow, SyncResponse, WorkoutRow } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { liveSets } from "@belay/shared/training/rules";
import { MAX_SETS, type Workout, type WorkoutSet } from "@belay/shared/training/workout";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { asUser } from "../src/db/client";
import { createSession, upsertUser } from "../src/db/identity";
import { workoutSets, workouts } from "../src/db/schema";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

// The server as it runs: the belay_app login role, row-level security on every request. The
// owner only arranges rows.
const { db } = appDb();
const owner = testDb().db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });

const AT = "2026-10-07T17:00:00.000Z";
const LATER = "2026-10-07T17:05:00.000Z";
const LATEST = "2026-10-07T17:10:00.000Z";
const PLAN = [...sessionByCode("A")!.slots];

async function signIn(sub: string) {
  const user = await upsertUser(db, { issuer: "https://idp.test", sub, displayName: sub });
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const sync = async (cursor: string, changes: Change[] = []) => {
    const res = await app.request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ account: user, cursor, changes }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as SyncResponse;
  };
  return { user, sync };
}

const start = (id: string, at = AT, code = "A"): Change => ({
  kind: "workout",
  id,
  field: "start",
  sessionCode: code,
  plan: PLAN,
  startedAt: at,
  at,
});
const create = (
  id: string,
  workoutId: string,
  position = 3,
  patch: Partial<Extract<Change, { kind: "set"; field: "create" }>> = {},
): Change => ({
  kind: "set",
  id,
  workoutId,
  field: "create",
  slotIndex: 0,
  position,
  exerciseId: "ds:0025",
  warmup: false,
  weightKg: 82.5,
  reps: 8,
  rir: 1,
  doneAt: LATER,
  at: LATER,
  ...patch,
});
const values = (id: string, workoutId: string, reps: number, at: string): Change => ({
  kind: "set",
  id,
  workoutId,
  field: "values",
  weightKg: 82.5,
  reps,
  rir: null,
  at,
});
const note = (id: string, value: string | null, at: string): Change => ({
  kind: "workout",
  id,
  field: "note",
  value,
  at,
});

// The answer's rows as the shared rules read them on the phone.
const history = (res: SyncResponse) => ({
  workouts: res.workouts.map((w: WorkoutRow): Workout => ({
    id: w.id,
    sessionCode: w.sessionCode,
    plan: w.plan,
    startedAt: w.startedAt,
    endedAt: w.endedAt,
    note: w.note,
    exerciseNotes: w.exerciseNotes,
    removed: w.removed,
  })),
  sets: res.sets.map((s: SetRow): WorkoutSet => ({
    id: s.id,
    workoutId: s.workoutId,
    slotIndex: s.slotIndex,
    position: s.position,
    exerciseId: s.exerciseId,
    warmup: s.warmup,
    weightKg: s.weightKg,
    reps: s.reps,
    rir: s.rir,
    doneAt: s.doneAt,
    removed: s.removed,
  })),
});

describe("a session through /api/sync", () => {
  it("starts a session with its plan and records its sets", async () => {
    const { user, sync } = await signIn("wk-start");
    const w = newId();
    const set = newId();
    const res = await sync("0", [start(w), create(set, w)]);
    expect(res.rejected).toEqual([]);
    expect(res.workouts).toEqual([
      {
        id: w,
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
      },
    ]);
    expect(res.sets).toEqual([
      {
        id: set,
        workoutId: w,
        slotIndex: 0,
        position: 3,
        exerciseId: "ds:0025",
        warmup: false,
        weightKg: 82.5,
        reps: 8,
        rir: 1,
        doneAt: LATER,
        fieldsAt: LATER,
        removed: false,
        removedAt: null,
      },
    ]);
    expect(await owner.select().from(workoutSets).where(eq(workoutSets.userId, user))).toHaveLength(
      1,
    );
  });

  it("changes nothing when a start or a set is replayed, and keeps the first start", async () => {
    const { user, sync } = await signIn("wk-replay");
    const w = newId();
    const set = newId();
    const first = await sync("0", [start(w), create(set, w)]);
    const replay = await sync(first.cursor, [start(w), create(set, w)]);
    expect(replay.cursor).toBe(first.cursor);
    expect(replay.sets).toEqual([]);
    // Another start of the same session: ignored, and the stored one comes back.
    const other = await sync(first.cursor, [start(w, LATER, "B"), create(set, w, 3, { reps: 3 })]);
    expect(other.workouts.map((r) => [r.sessionCode, r.startedAt])).toEqual([["A", AT]]);
    const [row] = await owner.select().from(workoutSets).where(eq(workoutSets.userId, user));
    expect(row?.reps).toBe(8);
  });

  it("merges each field of a session on its own: the later write wins", async () => {
    const { sync } = await signIn("wk-fields");
    const w = newId();
    await sync("0", [start(w), note(w, "Bonne séance", LATEST)]);
    const res = await sync("0", [
      note(w, "Plus tôt", LATER), // older than what is stored: loses, the stored note comes back
      { kind: "workout", id: w, field: "ended", value: LATER, at: LATER },
      { kind: "workout", id: w, field: "exerciseNotes", value: { "0": "Prise large" }, at: LATER },
    ]);
    const [row] = res.workouts;
    expect(row).toMatchObject({
      note: "Bonne séance",
      noteAt: LATEST,
      endedAt: LATER,
      endedAtAt: LATER,
      exerciseNotes: { "0": "Prise large" },
    });
  });

  it("merges a set's load, reps and RIR together, and sends a losing change back", async () => {
    const { sync } = await signIn("wk-values");
    const w = newId();
    const set = newId();
    const first = await sync("0", [start(w), create(set, w), values(set, w, 7, LATEST)]);
    expect(first.sets[0]).toMatchObject({ reps: 7, rir: null, fieldsAt: LATEST });
    const late = await sync(first.cursor, [values(set, w, 6, LATER)]);
    expect(late.sets).toEqual([expect.objectContaining({ id: set, reps: 7 })]);
  });

  it("refuses a set of an exercise the library lacks, and that set only", async () => {
    const { sync } = await signIn("wk-exercise");
    const w = newId();
    const bad = newId();
    const res = await sync("0", [
      start(w),
      create(bad, w, 3, { exerciseId: "ds:9999" }),
      values(bad, w, 6, LATEST),
      create(newId(), w, 4),
    ]);
    expect(res.rejected).toEqual([
      { index: 1, reason: "unknown_exercise" },
      { index: 2, reason: "unknown_exercise" },
    ]);
    expect(res.sets.map((s) => s.position)).toEqual([4]);
  });

  it("refuses a set on someone else's session, or on a session never started", async () => {
    const a = await signIn("wk-owner-a");
    const b = await signIn("wk-owner-b");
    const w = newId();
    await a.sync("0", [start(w)]);
    const res = await b.sync("0", [create(newId(), w), create(newId(), newId())]);
    expect(res.rejected).toEqual([
      { index: 0, reason: "unknown" },
      { index: 1, reason: "unknown" },
    ]);
    // Nor can B take A's session id for one of its own.
    const taken = await b.sync("0", [start(w, LATER, "B"), note(w, "à moi", LATER)]);
    expect(taken.rejected).toEqual([
      { index: 0, reason: "unknown" },
      { index: 1, reason: "unknown" },
    ]);
    expect(taken.workouts).toEqual([]);
  });

  it("refuses the sets of a session past 150, and only those", async () => {
    const { user, sync } = await signIn("wk-many");
    const w = newId();
    await sync("0", [start(w)]);
    // 149 sets already there, written as the owner to keep the test short.
    await owner.insert(workoutSets).values(
      Array.from({ length: MAX_SETS - 1 }, (_, i) => ({
        id: newId(),
        userId: user,
        workoutId: w,
        slotIndex: i % 30,
        position: 3 + (i % 10),
        exerciseId: "ds:0025",
        warmup: false,
        weightKg: 20,
        reps: 10,
        doneAt: new Date(LATER),
        fieldsAt: new Date(LATER),
      })),
    );
    const last = newId();
    const res = await sync("0", [create(last, w), create(newId(), w, 4), create(newId(), w, 5)]);
    expect(res.rejected).toEqual([
      { index: 1, reason: "too_many_sets" },
      { index: 2, reason: "too_many_sets" },
    ]);
    const [{ n } = { n: 0 }] = await owner.execute<{ n: number }>(
      sql`select count(*)::int as n from workout_sets where workout_id = ${w}`,
    );
    expect(n).toBe(MAX_SETS);
  });

  it("counts a restored set against the 150 ceiling", async () => {
    const { user, sync } = await signIn("wk-restore");
    const w = newId();
    await sync("0", [start(w)]);
    const row = (removed: boolean) => ({
      id: newId(),
      userId: user,
      workoutId: w,
      slotIndex: 0,
      position: 3,
      exerciseId: "ds:0025",
      warmup: false,
      weightKg: 20,
      reps: 10,
      doneAt: new Date(LATER),
      fieldsAt: new Date(LATER),
      removed,
    });
    const live = Array.from({ length: MAX_SETS - 2 }, () => row(false));
    const gone = Array.from({ length: 4 }, () => row(true));
    await owner.insert(workoutSets).values([...live, ...gone]);
    const restore = (id: string): Change => ({
      kind: "set",
      id,
      workoutId: w,
      field: "removed",
      value: false,
      at: LATEST,
    });
    const res = await sync(
      "0",
      gone.map((g) => restore(g.id)),
    );
    expect(res.rejected).toEqual([
      { index: 2, reason: "too_many_sets" },
      { index: 3, reason: "too_many_sets" },
    ]);
    const [{ n } = { n: 0 }] = await owner.execute<{ n: number }>(
      sql`select count(*)::int as n from workout_sets where workout_id = ${w} and not removed`,
    );
    expect(n).toBe(MAX_SETS);
  });

  it("keeps a removed session's sets, which the shared rules never show", async () => {
    const { sync } = await signIn("wk-removed");
    const w = newId();
    await sync("0", [start(w), create(newId(), w), create(newId(), w, 4)]);
    const res = await sync("0", [
      { kind: "workout", id: w, field: "removed", value: true, at: LATEST },
    ]);
    expect(res.workouts[0]).toMatchObject({ removed: true, removedAt: LATEST });
    expect(res.sets).toHaveLength(2);
    expect(res.sets.every((s) => !s.removed)).toBe(true);
    expect(liveSets(history(res))).toEqual([]);
  });

  it("brings a time from a clock running ahead back to the server's", async () => {
    const { sync } = await signIn("wk-clock");
    const w = newId();
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    const before = Date.now();
    const res = await sync("0", [start(w, ahead)]);
    const startedAt = Date.parse(res.workouts[0]!.startedAt);
    expect(startedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(startedAt).toBeLessThanOrEqual(Date.now());
  });

  it("isolates two people, through the API and in SQL", async () => {
    const a = await signIn("wk-iso-a");
    const b = await signIn("wk-iso-b");
    const w = newId();
    await a.sync("0", [start(w), create(newId(), w)]);
    const seen = await b.sync("0");
    expect(seen.workouts).toEqual([]);
    expect(seen.sets).toEqual([]);
    const rows = await asUser(db, b.user, async (tx) => [
      ...(await tx.select().from(workouts)),
      ...(await tx.select().from(workoutSets)),
    ]);
    expect(rows).toEqual([]);
  });
});
