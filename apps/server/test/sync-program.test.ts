import { newId } from "@belay/shared";
import type { Change, ProgramSlotRow, SyncResponse } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import {
  DEFAULT_SCHEDULE,
  MAX_PROGRAMS,
  MAX_ROTATION,
  MAX_SESSIONS,
  type ProgramSlot,
  rotationOf,
  SEED,
  SEED_PROGRAM_ID,
  seedId,
  type StoredPrograms,
} from "@belay/shared/training/stored-program";
import { MAX_SLOTS } from "@belay/shared/training/workout";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { createSession, upsertUser } from "../src/db/identity";
import {
  activePrograms,
  bodyMetrics,
  programSessions,
  programSlots,
  programs,
  workouts,
} from "../src/db/schema";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

// The server as it runs: the belay_app login role, row-level security on every request. The
// owner only arranges rows and reads them back.
const { db } = appDb();
const owner = testDb().db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });

const AT = "2026-10-07T17:00:00.000Z";
const LATER = "2026-10-07T17:05:00.000Z";
const LATEST = "2026-10-07T17:10:00.000Z";
const SCHEDULE = { ...DEFAULT_SCHEDULE, days: [...DEFAULT_SCHEDULE.days] };
const PROGRAM = SEED_PROGRAM_ID;
const SESSION_A = seedId(1);
const SESSION_B = seedId(2);
const SLOT_A1 = seedId(0x101); // ds:0025-like barbell slot, counted in reps
const TIMED = "ds:2135"; // weighted front plank, held in seconds
const COUNTED = "ds:0025";

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

const createProgram = (id: string, at = AT): Change => ({
  kind: "program",
  id,
  field: "create",
  name: null,
  schedule: SCHEDULE,
  at,
});
const renameProgram = (id: string, value: string | null, at = AT): Change => ({
  kind: "program",
  id,
  field: "name",
  value,
  at,
});
const removeProgram = (id: string, value: boolean, at = AT): Change => ({
  kind: "program",
  id,
  field: "removed",
  value,
  at,
});
const choose = (programId: string, at = AT): Change => ({ kind: "activeProgram", programId, at });
const createSessionChange = (
  id: string,
  programId: string | null,
  position: number,
  at = AT,
): Change => ({ kind: "programSession", id, field: "create", name: null, programId, position, at });
const renameSession = (id: string, value: string | null, at = AT): Change => ({
  kind: "programSession",
  id,
  field: "name",
  value,
  at,
});
const place = (id: string, programId: string | null, position: number, at = AT): Change => ({
  kind: "programSession",
  id,
  field: "place",
  programId,
  position,
  at,
});
const removeSession = (id: string, value: boolean, at = AT): Change => ({
  kind: "programSession",
  id,
  field: "removed",
  value,
  at,
});
const createSlot = (
  id: string,
  sessionId: string,
  patch: Record<string, unknown> = {},
  at = AT,
): Change =>
  ({
    kind: "programSlot",
    id,
    field: "create",
    sessionId,
    position: 20,
    rule: null,
    exerciseId: COUNTED,
    sets: 3,
    repRange: [8, 12],
    rirTarget: [1, 2],
    restSec: 120,
    warmupSets: 1,
    isMain: false,
    groupKey: null,
    at,
    ...patch,
  }) as Change;
const slotField = (id: string, field: string, value: unknown, at = AT): Change =>
  ({ kind: "programSlot", id, field, value, at }) as Change;
const slotReps = (
  id: string,
  value: [number, number],
  measure: "seconds" | null,
  at = AT,
): Change => ({ kind: "programSlot", id, field: "reps", value, measure, at });
const slotWarmups = (id: string, value: 0 | 1 | 2 | 3, measure: "seconds" | null, at = AT) =>
  ({ kind: "programSlot", id, field: "warmups", value, measure, at }) as Change;
const slotExercise = (
  id: string,
  exerciseId: string,
  measure: "seconds" | null,
  repRange: [number, number],
  warmupSets: 0 | 1 | 2 | 3,
  at = AT,
): Change => ({
  kind: "programSlot",
  id,
  field: "exercise",
  exerciseId,
  measure,
  repRange,
  warmupSets,
  at,
});

// The refusals by place in the request: each kind of change is written in its own pass.
const rejected = (res: SyncResponse) => [...res.rejected].sort((a, b) => a.index - b.index);

// The answer's program rows as the phone reads them: times stripped.
const slotOf = (r: ProgramSlotRow): ProgramSlot => ({
  id: r.id,
  sessionId: r.sessionId,
  position: r.position,
  exerciseId: r.exerciseId,
  ...(r.measure === "seconds" && { measure: "seconds" as const }),
  sets: r.sets,
  repRange: r.repRange,
  rirTarget: r.rirTarget,
  restSec: r.restSec,
  warmupSets: r.warmupSets as ProgramSlot["warmupSets"],
  isMain: r.isMain,
  groupKey: r.groupKey,
  rule: r.rule,
  removed: r.removed,
});
const byId = <T extends { id: string }>(rows: readonly T[]) =>
  [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
const storedOf = (res: SyncResponse): StoredPrograms => ({
  activeId: res.activeProgram?.programId ?? null,
  activeAt: res.activeProgram?.at ?? null,
  programs: byId(
    (res.programs ?? []).map(({ id, name, schedule, removed }) => ({
      id,
      name,
      schedule,
      removed,
    })),
  ),
  sessions: byId(
    (res.programSessions ?? []).map(({ id, name, programId, position, removed }) => ({
      id,
      name,
      programId,
      position,
      removed,
    })),
  ),
  slots: byId((res.programSlots ?? []).map(slotOf)),
});

const programRow = async (user: string, id: string) =>
  (
    await owner
      .select()
      .from(programs)
      .where(and(eq(programs.userId, user), eq(programs.id, id)))
  )[0];
const sessionRow = async (user: string, id: string) =>
  (
    await owner
      .select()
      .from(programSessions)
      .where(and(eq(programSessions.userId, user), eq(programSessions.id, id)))
  )[0];
const slotRow = async (user: string, id: string) =>
  (
    await owner
      .select()
      .from(programSlots)
      .where(and(eq(programSlots.userId, user), eq(programSlots.id, id)))
  )[0];
const pointer = async (user: string) =>
  (await owner.select().from(activePrograms).where(eq(activePrograms.userId, user)))[0];
const counts = async (user: string) => {
  const n = async (t: typeof programs | typeof programSessions | typeof programSlots) =>
    (
      await owner
        .select({ n: sql<number>`count(*)::int` })
        .from(t)
        .where(eq(t.userId, user))
    )[0]!.n;
  return {
    programs: await n(programs),
    pointers: (await owner.select().from(activePrograms).where(eq(activePrograms.userId, user)))
      .length,
    sessions: await n(programSessions),
    slots: await n(programSlots),
  };
};
const SEEDED = { programs: 1, pointers: 1, sessions: 3, slots: SEED.slots.length };

describe("the starting program", () => {
  it("an account with history syncs once and holds the active starting program, its past sessions unchanged", async () => {
    const { user, sync } = await signIn("pg-history");
    const past = newId();
    await owner.insert(workouts).values({
      id: past,
      userId: user,
      sessionCode: "B",
      plan: [...sessionByCode("B", starterProgram)!.slots],
      startedAt: new Date(AT),
      endedAt: new Date(LATER),
    });
    await owner
      .insert(bodyMetrics)
      .values({ userId: user, date: "2026-10-06", weightKg: 80, weightAt: new Date(AT) });
    const before = {
      workouts: await owner.select().from(workouts).where(eq(workouts.userId, user)),
      body: await owner.select().from(bodyMetrics).where(eq(bodyMetrics.userId, user)),
    };

    const res = await sync("0");
    expect(rejected(res)).toEqual([]);
    expect(res.activeProgram).toEqual({ programId: PROGRAM, at: null });
    expect(res.programs).toEqual([
      {
        id: PROGRAM,
        name: null,
        nameAt: null,
        schedule: SCHEDULE,
        scheduleAt: null,
        removed: false,
        removedAt: null,
      },
    ]);
    // Every time null: nothing written since the start, so any edit wins over the seed.
    for (const s of res.programSessions!)
      expect([s.nameAt, s.placeAt, s.removedAt]).toEqual([null, null, null]);
    for (const s of res.programSlots!)
      expect(Object.entries(s).filter(([k, v]) => k.endsWith("At") && v !== null)).toEqual([]);
    const stored = storedOf(res);
    expect(stored).toEqual({
      ...SEED,
      programs: byId(SEED.programs),
      sessions: byId(SEED.sessions),
      slots: byId(SEED.slots),
    });
    expect(rotationOf(stored)).toEqual(rotationOf(SEED));
    expect(res.workouts.map((w) => [w.id, w.sessionCode])).toEqual([[past, "B"]]);
    expect({
      workouts: await owner.select().from(workouts).where(eq(workouts.userId, user)),
      body: await owner.select().from(bodyMetrics).where(eq(bodyMetrics.userId, user)),
    }).toEqual(before);
  });

  it("seeds once over two and two concurrent syncs", async () => {
    const one = await signIn("pg-once");
    const first = await one.sync("0");
    const second = await one.sync(first.cursor);
    expect(second.programs).toBeUndefined();
    expect(second.programSlots).toBeUndefined();
    expect(second.activeProgram ?? null).toBeNull();
    expect(second.cursor).toBe(first.cursor);
    await one.sync("0");
    expect(await counts(one.user)).toEqual(SEEDED);

    const two = await signIn("pg-concurrent");
    const answers = await Promise.all([two.sync("0"), two.sync("0")]);
    expect(await counts(two.user)).toEqual(SEEDED);
    for (const a of answers) expect(storedOf(a).slots).toHaveLength(SEED.slots.length);
  });

  it("an edit made before the first sync lands on the seeded row", async () => {
    const { user, sync } = await signIn("pg-early-edit");
    const res = await sync("0", [
      renameSession(SESSION_A, "Haut", AT),
      slotField(SLOT_A1, "sets", 5, AT),
      renameProgram(PROGRAM, "Force", AT),
    ]);
    expect(rejected(res)).toEqual([]);
    expect(res.programSessions!.find((s) => s.id === SESSION_A)).toMatchObject({
      name: "Haut",
      nameAt: AT,
    });
    expect(res.programSlots!.find((s) => s.id === SLOT_A1)).toMatchObject({ sets: 5, setsAt: AT });
    expect(res.programs).toEqual([expect.objectContaining({ name: "Force", nameAt: AT })]);
    expect(await counts(user)).toEqual(SEEDED);
  });
});

describe("program edits through /api/sync", () => {
  it("a creation replayed changes nothing", async () => {
    const { user, sync } = await signIn("pg-replay");
    const p = newId();
    const s = newId();
    const l = newId();
    const batch = [createProgram(p), createSessionChange(s, p, 0), createSlot(l, s)];
    const first = await sync("0", batch);
    expect(rejected(first)).toEqual([]);
    const rows = async () => [
      await programRow(user, p),
      await sessionRow(user, s),
      await slotRow(user, l),
    ];
    const before = await rows();
    expect(before.every(Boolean)).toBe(true);
    const replay = await sync(first.cursor, [
      ...batch,
      { ...createProgram(p, LATER), name: "Autre" } as Change,
    ]);
    expect(rejected(replay)).toEqual([]);
    expect(replay.cursor).toBe(first.cursor);
    expect(await rows()).toEqual(before);
    expect(await counts(user)).toEqual({
      ...SEEDED,
      programs: 2,
      sessions: 4,
      slots: SEED.slots.length + 1,
    });
  });

  it("an edit sent at its creation's instant applies", async () => {
    const { user, sync } = await signIn("pg-same-instant");
    const p = newId();
    const s = newId();
    const l = newId();
    const res = await sync("0", [
      createProgram(p),
      renameProgram(p, "Edited", AT),
      createSessionChange(s, p, 0),
      createSlot(l, s),
      slotField(l, "sets", 5, AT),
    ]);
    expect(rejected(res)).toEqual([]);
    expect(await programRow(user, p)).toMatchObject({ name: "Edited" });
    expect(await slotRow(user, l)).toMatchObject({ sets: 5 });
  });

  it("an older change loses and gets its row back", async () => {
    const { user, sync } = await signIn("pg-older");
    const { cursor } = await sync("0", [
      renameProgram(PROGRAM, "Force", LATER),
      renameSession(SESSION_A, "Haut", LATER),
      slotField(SLOT_A1, "sets", 5, LATER),
    ]);
    const res = await sync(cursor, [
      renameProgram(PROGRAM, "Volume", AT),
      renameSession(SESSION_A, "Bas", AT),
      slotField(SLOT_A1, "sets", 2, AT),
    ]);
    expect(rejected(res)).toEqual([]);
    expect(res.programs).toEqual([expect.objectContaining({ id: PROGRAM, name: "Force" })]);
    expect(res.programSessions).toEqual([expect.objectContaining({ id: SESSION_A, name: "Haut" })]);
    expect(res.programSlots).toEqual([expect.objectContaining({ id: SLOT_A1, sets: 5 })]);
    expect((await programRow(user, PROGRAM))!.name).toBe("Force");
    expect((await slotRow(user, SLOT_A1))!.sets).toBe(5);
  });

  it("two devices changing sets and rest of one slot keep both", async () => {
    const { user, sync } = await signIn("pg-two-devices");
    await sync("0", [slotField(SLOT_A1, "sets", 4, AT)]);
    const second = await sync("0", [slotField(SLOT_A1, "rest", 90, LATER)]);
    expect(rejected(second)).toEqual([]);
    expect(second.programSlots!.find((s) => s.id === SLOT_A1)).toMatchObject({
      sets: 4,
      setsAt: AT,
      restSec: 90,
      restAt: LATER,
    });
    expect(await slotRow(user, SLOT_A1)).toMatchObject({ sets: 4, restSec: 90 });
  });

  it("two edits of a slot clamped to the same instant keep the later one", async () => {
    const { user, sync } = await signIn("pg-clamped");
    const res = await sync("0", [
      slotField(SLOT_A1, "sets", 4, "2099-01-01T00:00:00.000Z"),
      slotField(SLOT_A1, "sets", 5, "2099-01-02T00:00:00.000Z"),
    ]);
    expect(rejected(res)).toEqual([]);
    expect((await slotRow(user, SLOT_A1))!.sets).toBe(5);
  });

  it("two edits of a slot at one instant, written with and without milliseconds, keep the later one", async () => {
    const { user, sync } = await signIn("pg-same-instant");
    const res = await sync("0", [
      slotField(SLOT_A1, "sets", 4, "2026-10-07T17:00:00.000Z"),
      slotField(SLOT_A1, "sets", 5, "2026-10-07T17:00:00Z"),
    ]);
    expect(rejected(res)).toEqual([]);
    expect((await slotRow(user, SLOT_A1))!.sets).toBe(5);
  });

  it("a session set aside and placed back", async () => {
    const { user, sync } = await signIn("pg-aside");
    const aside = await sync("0", [place(SESSION_B, null, 0, AT)]);
    expect(rejected(aside)).toEqual([]);
    expect(rotationOf(storedOf(aside)).map((t) => t.sessionId)).toEqual([SESSION_A, seedId(3)]);
    expect(await sessionRow(user, SESSION_B)).toMatchObject({ programId: null, position: 0 });
    const back = await sync(aside.cursor, [place(SESSION_B, PROGRAM, 1, LATER)]);
    expect(rejected(back)).toEqual([]);
    expect(back.programSessions).toEqual([
      expect.objectContaining({ id: SESSION_B, programId: PROGRAM, position: 1, placeAt: LATER }),
    ]);
  });

  it("a session placed in an unknown program is refused alone", async () => {
    const other = await signIn("pg-unknown-other");
    const theirs = newId();
    await other.sync("0", [createProgram(theirs)]);
    const { user, sync } = await signIn("pg-unknown");
    const lost = newId();
    const first = await sync("0");
    const res = await sync(first.cursor, [
      place(SESSION_A, newId(), 0),
      place(SESSION_B, theirs, 0),
      renameSession(SESSION_A, "Haut"),
      createSessionChange(lost, theirs, 0),
      renameSession(lost, "Perdue"),
      renameProgram(newId(), "Personne"),
      slotField(newId(), "sets", 3),
    ]);
    expect(rejected(res)).toEqual([
      { index: 0, reason: "unknown" },
      { index: 1, reason: "unknown" },
      { index: 3, reason: "unknown" },
      { index: 4, reason: "unknown" },
      { index: 5, reason: "unknown" },
      { index: 6, reason: "unknown" },
    ]);
    expect(await sessionRow(user, SESSION_A)).toMatchObject({
      name: "Haut",
      programId: PROGRAM,
      position: 0,
    });
    expect(await sessionRow(user, SESSION_B)).toMatchObject({ programId: PROGRAM, position: 1 });
    // The refused places get their stored rows back.
    expect(res.programSessions?.map((r) => r.id).sort()).toEqual([SESSION_A, SESSION_B].sort());
    expect(await sessionRow(user, lost)).toBeUndefined();
    expect(await counts(user)).toEqual(SEEDED);
  });

  it("the active pointer to an unknown program is refused", async () => {
    const other = await signIn("pg-pointer-other");
    const theirs = newId();
    await other.sync("0", [createProgram(theirs)]);
    const { user, sync } = await signIn("pg-pointer");
    const gone = newId();
    const { cursor } = await sync("0", [createProgram(gone), removeProgram(gone, true)]);
    const res = await sync(cursor, [choose(newId()), choose(theirs, LATER), choose(gone, LATEST)]);
    expect(rejected(res)).toEqual([
      { index: 0, reason: "unknown" },
      { index: 1, reason: "unknown" },
      { index: 2, reason: "refused" },
    ]);
    expect(res.activeProgram).toEqual({ programId: PROGRAM, at: null });
    expect(await pointer(user)).toMatchObject({ programId: PROGRAM, at: null });

    const next = newId();
    const moved = await sync(res.cursor, [createProgram(next), choose(next, LATER)]);
    expect(rejected(moved)).toEqual([]);
    expect(moved.activeProgram).toEqual({ programId: next, at: LATER });
    const older = await sync(moved.cursor, [choose(PROGRAM, AT)]);
    expect(rejected(older)).toEqual([]);
    expect(older.activeProgram).toEqual({ programId: next, at: LATER });
  });

  it("never removes the active program, but takes a switch then the removal in one batch", async () => {
    const { user, sync } = await signIn("pg-remove-active");
    const { cursor } = await sync("0");
    const refused = await sync(cursor, [removeProgram(PROGRAM, true)]);
    expect(rejected(refused)).toEqual([{ index: 0, reason: "refused" }]);
    expect(refused.programs).toEqual([expect.objectContaining({ id: PROGRAM, removed: false })]);

    const next = newId();
    const switched = await sync(refused.cursor, [
      createProgram(next),
      choose(next, LATER),
      removeProgram(PROGRAM, true, LATEST),
    ]);
    expect(rejected(switched)).toEqual([]);
    expect(await pointer(user)).toMatchObject({ programId: next });
    expect((await programRow(user, PROGRAM))!.removed).toBe(true);

    // Another device chose the program this batch removes: the pointer stays, so does it.
    const back = await sync(switched.cursor, [
      removeProgram(PROGRAM, false, "2026-10-07T17:15:00.000Z"),
    ]);
    expect(rejected(back)).toEqual([]);
    await sync(back.cursor, [choose(PROGRAM, "2026-10-07T17:20:00.000Z")]);
    const late = await sync(back.cursor, [
      removeProgram(PROGRAM, true, "2026-10-07T17:30:00.000Z"),
    ]);
    expect(rejected(late)).toEqual([{ index: 0, reason: "refused" }]);
    expect((await programRow(user, PROGRAM))!.removed).toBe(false);
  });

  it("unknown exercise, wrong measure refused alone", async () => {
    const { user, sync } = await signIn("pg-exercise");
    const a = newId();
    const b = newId();
    const res = await sync("0", [
      createSlot(a, SESSION_A, { exerciseId: "ds:9999" }),
      createSlot(b, SESSION_A, { exerciseId: TIMED, warmupSets: 0 }),
      slotExercise(SLOT_A1, TIMED, null, [8, 12], 0),
      slotExercise(seedId(0x102), "ds:9999", null, [8, 12], 1),
      slotField(SLOT_A1, "sets", 4),
    ]);
    expect(rejected(res)).toEqual([
      { index: 0, reason: "unknown_exercise" },
      { index: 1, reason: "wrong_measure" },
      { index: 2, reason: "wrong_measure" },
      { index: 3, reason: "unknown_exercise" },
    ]);
    expect(await slotRow(user, a)).toBeUndefined();
    expect(await slotRow(user, b)).toBeUndefined();
    expect(await slotRow(user, SLOT_A1)).toMatchObject({ sets: 4, measure: null });
    expect(res.programSlots!.find((s) => s.id === SLOT_A1)!.exerciseId).not.toBe(TIMED);
  });

  it("a rep range or warm-ups written for reps, newer than an exercise change to a timed one, are refused and the row goes back, in either arrival order", async () => {
    // The exercise change first: the range and warm-ups written for reps come after and are refused.
    const one = await signIn("pg-measure-1");
    const { cursor } = await one.sync("0", [
      slotExercise(SLOT_A1, TIMED, "seconds", [30, 60], 0, AT),
    ]);
    const res = await one.sync(cursor, [
      slotReps(SLOT_A1, [8, 10], null, LATER),
      slotWarmups(SLOT_A1, 2, null, LATER),
    ]);
    expect(rejected(res)).toEqual([
      { index: 0, reason: "wrong_measure" },
      { index: 1, reason: "wrong_measure" },
    ]);
    expect(res.programSlots).toEqual([
      expect.objectContaining({
        id: SLOT_A1,
        measure: "seconds",
        repRange: [30, 60],
        warmupSets: 0,
      }),
    ]);
    // In one batch, the same.
    const two = await signIn("pg-measure-2");
    const batch = await two.sync("0", [
      slotExercise(SLOT_A1, TIMED, "seconds", [30, 60], 0, AT),
      slotReps(SLOT_A1, [8, 10], null, LATER),
    ]);
    expect(rejected(batch)).toEqual([{ index: 1, reason: "wrong_measure" }]);
    expect(await slotRow(two.user, SLOT_A1)).toMatchObject({
      repMin: 30,
      repMax: 60,
      measure: "seconds",
    });
    // The range first: the exercise in another measure replaces it however recent, so a range
    // written for reps is never read in seconds.
    const three = await signIn("pg-measure-3");
    const first = await three.sync("0", [slotReps(SLOT_A1, [8, 10], null, LATER)]);
    expect(rejected(first)).toEqual([]);
    const after = await three.sync(first.cursor, [
      slotExercise(SLOT_A1, TIMED, "seconds", [30, 60], 0, AT),
    ]);
    expect(rejected(after)).toEqual([]);
    expect(await slotRow(three.user, SLOT_A1)).toMatchObject({
      exerciseId: TIMED,
      measure: "seconds",
      repMin: 30,
      repMax: 60,
      warmupSets: 0,
    });
  });

  it("a timed exercise with its range is kept; a counted range past 100 refused", async () => {
    const { user, sync } = await signIn("pg-ranges");
    const timed = newId();
    const warmed = newId();
    const res = await sync("0", [
      createSlot(timed, SESSION_A, {
        exerciseId: TIMED,
        measure: "seconds",
        repRange: [30, 120],
        warmupSets: 0,
      }),
      slotExercise(SLOT_A1, COUNTED, "seconds", [30, 120], 0),
      createSlot(warmed, SESSION_A, {
        exerciseId: TIMED,
        measure: "seconds",
        repRange: [30, 60],
        warmupSets: 1,
      }),
      slotWarmups(timed, 1, "seconds", LATER),
    ]);
    expect(rejected(res)).toEqual([
      { index: 1, reason: "wrong_measure" },
      { index: 2, reason: "refused" },
      { index: 3, reason: "refused" },
    ]);
    expect(await slotRow(user, timed)).toMatchObject({
      measure: "seconds",
      repMin: 30,
      repMax: 120,
      warmupSets: 0,
    });
    expect(await slotRow(user, SLOT_A1)).toMatchObject({ measure: null });
    expect((await slotRow(user, SLOT_A1))!.repMax).toBeLessThanOrEqual(100);
    expect(await slotRow(user, warmed)).toBeUndefined();
  });

  it("a start's sessionId is stored and sent back; a start without it is stored", async () => {
    const { user, sync } = await signIn("pg-start");
    const plan = [...sessionByCode("B", starterProgram)!.slots];
    const recorded = newId();
    const bare = newId();
    const stray = newId();
    const unknownSession = newId();
    const start = (id: string, sessionId?: string | null): Change => ({
      kind: "workout",
      id,
      field: "start",
      sessionCode: "B",
      ...(sessionId !== undefined && { sessionId }),
      plan,
      startedAt: AT,
      at: AT,
    });
    const res = await sync("0", [
      start(recorded, SESSION_B),
      start(bare),
      start(stray, unknownSession),
    ]);
    expect(rejected(res)).toEqual([]);
    const rows = new Map(res.workouts.map((w) => [w.id, w]));
    expect(rows.get(recorded)!.sessionId).toBe(SESSION_B);
    expect(rows.get(bare)!.sessionId ?? null).toBeNull();
    expect(rows.get(stray)!.sessionId).toBe(unknownSession);
    const stored = new Map(
      (await owner.select().from(workouts).where(eq(workouts.userId, user))).map((w) => [
        w.id,
        w.sessionId,
      ]),
    );
    expect(stored).toEqual(
      new Map([
        [recorded, SESSION_B],
        [bare, null],
        [stray, unknownSession],
      ]),
    );
    // Written once with the start: a second start of the same id changes nothing.
    await sync(res.cursor, [start(recorded, seedId(3))]);
    expect(
      (await owner.select().from(workouts).where(eq(workouts.id, recorded)))[0]!.sessionId,
    ).toBe(SESSION_B);
  });

  it("isolation: B's edit of a seed id changes B's row only", async () => {
    const a = await signIn("pg-iso-a");
    const b = await signIn("pg-iso-b");
    const first = await a.sync("0");
    await b.sync("0");
    const before = {
      program: await programRow(a.user, PROGRAM),
      session: await sessionRow(a.user, SESSION_A),
      slot: await slotRow(a.user, SLOT_A1),
      pointer: await pointer(a.user),
    };
    const own = newId();
    await a.sync(first.cursor, [createProgram(own)]);
    const res = await b.sync("0", [
      renameProgram(PROGRAM, "B", LATER),
      renameSession(SESSION_A, "B", LATER),
      place(SESSION_A, null, 0, LATER),
      slotField(SLOT_A1, "sets", 5, LATER),
      renameProgram(own, "pris", LATER),
      choose(own, LATER),
    ]);
    expect(rejected(res)).toEqual([
      { index: 4, reason: "unknown" },
      { index: 5, reason: "unknown" },
    ]);
    expect(await slotRow(b.user, SLOT_A1)).toMatchObject({ sets: 5 });
    expect({
      program: await programRow(a.user, PROGRAM),
      session: await sessionRow(a.user, SESSION_A),
      slot: await slotRow(a.user, SLOT_A1),
      pointer: await pointer(a.user),
    }).toEqual(before);
    expect((await programRow(a.user, own))!.name).toBeNull();
    // A's own program never reaches B, nor B's edits A.
    expect(storedOf(res).programs.map((p) => p.id)).toEqual([PROGRAM]);
    const again = await a.sync(first.cursor);
    expect(storedOf(again).programs.map((p) => [p.id, p.name])).toEqual([[own, null]]);
  });

  it("isolation: a slot created in another account's session is unknown and stored nowhere", async () => {
    const a = await signIn("pg-iso-slot-a");
    const b = await signIn("pg-iso-slot-b");
    const theirs = newId();
    await a.sync("0", [createSessionChange(theirs, null, 0)]);
    const slot = newId();
    const res = await b.sync("0", [createSlot(slot, theirs), slotField(slot, "sets", 4)]);
    expect(rejected(res)).toEqual([
      { index: 0, reason: "unknown" },
      { index: 1, reason: "unknown" },
    ]);
    expect(await slotRow(a.user, slot)).toBeUndefined();
    expect(await slotRow(b.user, slot)).toBeUndefined();
    expect(await sessionRow(b.user, theirs)).toBeUndefined();
  });

  it("program rows page with hasMore", async () => {
    const { user, sync } = await signIn("pg-paging");
    const start = await sync("0");
    expect(start.hasMore).toBe(false);
    await owner.insert(programSlots).values(
      Array.from({ length: 1001 }, (_, i) => ({
        userId: user,
        id: newId(),
        sessionId: SESSION_A,
        position: i % 1000,
        exerciseId: COUNTED,
        repMin: 8,
        repMax: 12,
        sets: 3,
        rirMin: 1,
        rirMax: 2,
        restSec: 120,
        warmupSets: 0,
        isMain: false,
      })),
    );
    const page1 = await sync(start.cursor);
    expect(page1.programSlots).toHaveLength(1000);
    expect(page1.hasMore).toBe(true);
    const page2 = await sync(page1.cursor);
    expect(page2.programSlots).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });
});

describe("abuse limits", () => {
  it("the 21st program, 201st session, 27th of a rotation, 31st slot are refused and nothing else", async () => {
    // Programs: the starting one and 19 more make 20 live; a removed one does not count.
    const p = await signIn("pg-limit-programs");
    const { cursor } = await p.sync("0");
    const removed = newId();
    await owner.insert(programs).values([
      ...Array.from({ length: MAX_PROGRAMS - 1 }, () => ({
        userId: p.user,
        id: newId(),
        schedule: SCHEDULE,
      })),
      { userId: p.user, id: removed, schedule: SCHEDULE, removed: true },
    ]);
    const extra = newId();
    const programs21 = await p.sync(cursor, [
      createProgram(extra),
      renameProgram(extra, "Trop"),
      removeProgram(removed, false),
      renameProgram(PROGRAM, "Ok"),
    ]);
    expect(rejected(programs21)).toEqual([
      { index: 0, reason: "refused" },
      { index: 1, reason: "refused" },
      { index: 2, reason: "refused" },
    ]);
    expect(await programRow(p.user, extra)).toBeUndefined();
    expect((await programRow(p.user, removed))!.removed).toBe(true);
    expect(programs21.programs!.find((r) => r.id === removed)).toMatchObject({ removed: true });
    expect((await programRow(p.user, PROGRAM))!.name).toBe("Ok");

    // Sessions: the starting three and 197 set aside make 200.
    const s = await signIn("pg-limit-sessions");
    const s0 = await s.sync("0");
    await owner.insert(programSessions).values(
      Array.from({ length: MAX_SESSIONS - 3 }, (_, i) => ({
        userId: s.user,
        id: newId(),
        programId: null,
        position: i,
      })),
    );
    const more = newId();
    const sessions201 = await s.sync(s0.cursor, [
      createSessionChange(more, null, 197),
      renameSession(SESSION_A, "Ok"),
    ]);
    expect(rejected(sessions201)).toEqual([{ index: 0, reason: "refused" }]);
    expect(await sessionRow(s.user, more)).toBeUndefined();
    expect((await sessionRow(s.user, SESSION_A))!.name).toBe("Ok");

    // A rotation: the starting three and 23 more make 26; the collection takes more.
    const r = await signIn("pg-limit-rotation");
    const r0 = await r.sync("0");
    const aside = newId();
    await owner.insert(programSessions).values([
      ...Array.from({ length: MAX_ROTATION - 3 }, (_, i) => ({
        userId: r.user,
        id: newId(),
        programId: PROGRAM,
        position: i + 3,
      })),
      { userId: r.user, id: aside, programId: null, position: 0 },
    ]);
    const into = newId();
    const kept = newId();
    const rotation27 = await r.sync(r0.cursor, [
      createSessionChange(into, PROGRAM, 26),
      place(aside, PROGRAM, 26),
      createSessionChange(kept, null, 1),
    ]);
    expect(rejected(rotation27)).toEqual([
      { index: 0, reason: "refused" },
      { index: 1, reason: "refused" },
    ]);
    expect(await sessionRow(r.user, into)).toBeUndefined();
    expect(await sessionRow(r.user, aside)).toMatchObject({ programId: null });
    expect(rotation27.programSessions!.find((x) => x.id === aside)).toMatchObject({
      programId: null,
    });
    expect(await sessionRow(r.user, kept)).toMatchObject({ programId: null, position: 1 });
    // A session taken out frees its place for the next change; put back, it no longer fits.
    const swapped = await r.sync(rotation27.cursor, [
      removeSession(seedId(3), true, LATER),
      place(aside, PROGRAM, 26, LATER),
    ]);
    expect(rejected(swapped)).toEqual([]);
    expect(await sessionRow(r.user, aside)).toMatchObject({ programId: PROGRAM, position: 26 });
    const putBack = await r.sync(swapped.cursor, [removeSession(seedId(3), false, LATEST)]);
    expect(rejected(putBack)).toEqual([{ index: 0, reason: "refused" }]);
    expect(putBack.programSessions).toEqual([
      expect.objectContaining({ id: seedId(3), removed: true }),
    ]);

    // Slots: session A filled to 30 live ones.
    const l = await signIn("pg-limit-slots");
    const l0 = await l.sync("0");
    const inA = SEED.slots.filter((x) => x.sessionId === SESSION_A).length;
    await owner.insert(programSlots).values(
      Array.from({ length: MAX_SLOTS - inA }, (_, i) => ({
        userId: l.user,
        id: newId(),
        sessionId: SESSION_A,
        position: 100 + i,
        exerciseId: COUNTED,
        repMin: 8,
        repMax: 12,
        sets: 3,
        rirMin: 1,
        rirMax: 2,
        restSec: 120,
        warmupSets: 0,
        isMain: false,
      })),
    );
    const slot31 = newId();
    const slots31 = await l.sync(l0.cursor, [
      createSlot(slot31, SESSION_A),
      slotField(SLOT_A1, "sets", 4),
      createSlot(newId(), SESSION_B),
    ]);
    expect(rejected(slots31)).toEqual([{ index: 0, reason: "refused" }]);
    expect(await slotRow(l.user, slot31)).toBeUndefined();
    expect((await slotRow(l.user, SLOT_A1))!.sets).toBe(4);
  });

  it("a slot put back past 30 live in its session is refused; one taken out first frees its place", async () => {
    const { user, sync } = await signIn("pg-limit-slot-restore");
    const { cursor } = await sync("0");
    const inA = SEED.slots.filter((x) => x.sessionId === SESSION_A).length;
    const aside = newId();
    const slot = (id: string, position: number, removed = false) => ({
      userId: user,
      id,
      sessionId: SESSION_A,
      position,
      exerciseId: COUNTED,
      repMin: 8,
      repMax: 12,
      sets: 3,
      rirMin: 1,
      rirMax: 2,
      restSec: 120,
      warmupSets: 0,
      isMain: false,
      removed,
    });
    await owner
      .insert(programSlots)
      .values([
        ...Array.from({ length: MAX_SLOTS - inA }, (_, i) => slot(newId(), 100 + i)),
        slot(aside, 99, true),
      ]);
    const full = await sync(cursor, [slotField(aside, "removed", false, LATER)]);
    expect(rejected(full)).toEqual([{ index: 0, reason: "refused" }]);
    expect((await slotRow(user, aside))!.removed).toBe(true);
    expect(full.programSlots!.find((r) => r.id === aside)).toMatchObject({ removed: true });
    const swapped = await sync(full.cursor, [
      slotField(SLOT_A1, "removed", true, LATEST),
      slotField(aside, "removed", false, LATEST),
    ]);
    expect(rejected(swapped)).toEqual([]);
    expect((await slotRow(user, aside))!.removed).toBe(false);
    expect((await slotRow(user, SLOT_A1))!.removed).toBe(true);
  });

  it("at 20 programs a removal frees its place for a later restore, in request order, but never the active program's", async () => {
    const { user, sync } = await signIn("pg-limit-swap");
    const { cursor } = await sync("0");
    const live = Array.from({ length: MAX_PROGRAMS - 1 }, () => newId());
    const [one, two] = [newId(), newId()];
    await owner
      .insert(programs)
      .values([
        ...live.map((id) => ({ userId: user, id, schedule: SCHEDULE })),
        ...[one, two].map((id) => ({ userId: user, id, schedule: SCHEDULE, removed: true })),
      ]);
    // The restore before the removal finds no room; the one after it takes the freed place.
    const swapped = await sync(cursor, [
      removeProgram(one, false, LATER),
      removeProgram(live[0]!, true, LATER),
      removeProgram(two, false, LATER),
    ]);
    expect(rejected(swapped)).toEqual([{ index: 0, reason: "refused" }]);
    expect((await programRow(user, one))!.removed).toBe(true);
    expect((await programRow(user, live[0]!))!.removed).toBe(true);
    expect((await programRow(user, two))!.removed).toBe(false);
    // The active program's removal is refused, so it frees nothing.
    const active = await sync(swapped.cursor, [
      removeProgram(PROGRAM, true, LATEST),
      removeProgram(one, false, LATEST),
    ]);
    expect(rejected(active)).toEqual([
      { index: 0, reason: "refused" },
      { index: 1, reason: "refused" },
    ]);
    expect((await programRow(user, PROGRAM))!.removed).toBe(false);
    expect((await programRow(user, one))!.removed).toBe(true);
    // A switch away from it in the same batch frees its place.
    const switched = await sync(active.cursor, [
      choose(live[1]!, LATEST),
      removeProgram(PROGRAM, true, "2026-10-07T17:15:00.000Z"),
      removeProgram(one, false, "2026-10-07T17:15:00.000Z"),
    ]);
    expect(rejected(switched)).toEqual([]);
    expect(await pointer(user)).toMatchObject({ programId: live[1] });
    expect((await programRow(user, PROGRAM))!.removed).toBe(true);
    expect((await programRow(user, one))!.removed).toBe(false);
  });
});
