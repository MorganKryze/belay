// Writes the cases the native core is tested against, computed by the shared rules: change
// validity for sessions and sets at each bound, the exact JSON each change is sent as, field
// merge and time clamping, the instant and id formats; then the session rules (order of sets,
// rest, prefill, closing a forgotten session) and the schedule rules (plan of the day, rotation,
// fixed days, in several time zones), the session's tools (loading a bar, warm-ups, editing the
// day's plan, pausing), which workouts Health should hold, and the starting program the native
// core ships. With
// --check, fails if a committed file is not what the rules give today, so a rule changed here
// cannot drift from the Swift port.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { EXERCISE_ID } from "../packages/shared/src/exercises/library";
import {
  DAY,
  EARLIEST,
  finishedSpan,
  ownerOf,
  planHealth,
  sessionKey,
  versionOf,
} from "../apps/web/src/native/health-plan";
import type { Written } from "../apps/web/src/native/health";
import { MAX_CHANGES } from "../packages/shared/src/sync/limits";
import { clampAt, isNewer } from "../packages/shared/src/sync/merge";
import { ChangeSchema, type Change } from "../packages/shared/src/sync/schema";
import { isValidChange } from "../packages/shared/src/sync/valid";
import { type Activity, climbedThisWeek } from "../packages/shared/src/training/activities";
import { MAX_TARGET_KG, nearestLoading, PLATE_PRESETS } from "../packages/shared/src/tools/plates";
import {
  defaultWarmupCount,
  WARMUP_SCHEMES,
  type WarmupCount,
  warmupSets,
} from "../packages/shared/src/tools/warmup";
import {
  pauseEndedBy,
  type PauseStops,
  restClock,
  resumedRestEnd,
  resumedStart,
  sessionElapsed,
} from "../packages/shared/src/training/pause";
import {
  appendSlot,
  liveSlots,
  planFor,
  replaceSlot,
  skipSlot,
} from "../packages/shared/src/training/plan";
import {
  estimatedMinutes,
  plannedWorkSets,
  sessionByCode,
  starterProgram,
} from "../packages/shared/src/training/program";
import {
  autoClose,
  FORGOTTEN_MS,
  type History,
  lastTime,
  liveSets,
  nextTurn,
  openWorkout,
  prefill,
  restEndsAt,
  restSecAfter,
  sessionProgress,
  summary,
  type Turn,
  turnKey,
  warmups,
  workOrder,
} from "../packages/shared/src/training/rules";
import { plannedNext } from "../packages/shared/src/training/schedule";
import * as fx from "../packages/shared/src/training/schedule-fixtures";
import {
  type LetteredTemplate,
  MAX_ROTATION,
  nextInRotation,
  rotationOf,
  SEED,
  seedId,
  SESSION_NAME_MAX,
  type StoredPrograms,
  withSeed,
} from "../packages/shared/src/training/stored-program";
import {
  CLOCK_SLACK_MS,
  MAX_POSITION,
  MAX_SLOTS,
  MAX_WARMUPS,
  MIN_TIME,
  NOTE_MAX,
  PLAN_MAX_BYTES,
  REPS,
  RIR_MAX,
  SECONDS,
  SET_KG,
  SLOT_BOUNDS,
  type Slot,
  type Workout,
  type WorkoutSet,
  workPosition,
} from "../packages/shared/src/training/workout";

const core = (path: string) =>
  fileURLToPath(new URL(`../apps/apple/BelayCore/${path}`, import.meta.url));

const iso = (ms: number) => new Date(ms).toISOString();
// A fixed instant, so the file only changes when a rule does.
const T0 = Date.UTC(2026, 10, 6, 9, 30, 0, 123);
const AT = iso(T0);
const MIN_MS = Date.parse(MIN_TIME);
const WORKOUT = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f00";
const SESSION = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f01";
const SET = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f02";
const EXERCISE = "belay:barbell-hip-thrust";
const TIMED = "belay:dead-hang";

const slot: Slot = {
  exerciseId: EXERCISE,
  sets: 3,
  repRange: [8, 12],
  rirTarget: [1, 2],
  restSec: 120,
  warmupSets: 2,
  isMain: true,
  groupKey: null,
};
const timedSlot: Slot = { ...slot, exerciseId: TIMED, measure: "seconds", repRange: [20, 60] };
const plan = (...slots: unknown[]) => slots as Slot[];

// Each case is built as the phone writes it; `undefined` drops a key, as JSON.stringify does.
type Fields = Record<string, unknown>;
const start = (over: Fields = {}) => ({
  kind: "workout",
  id: WORKOUT,
  field: "start",
  sessionCode: "A",
  sessionId: SESSION,
  sessionName: "Push",
  plan: [slot],
  startedAt: iso(T0 - 60_000),
  at: AT,
  ...over,
});
const workout = (field: string, value: unknown, over: Fields = {}) => ({
  kind: "workout",
  id: WORKOUT,
  field,
  value,
  at: AT,
  ...over,
});
const withSlot = (over: Fields) => start({ plan: [{ ...slot, ...over }] });
const createSet = (over: Fields = {}) => ({
  kind: "set",
  id: SET,
  workoutId: WORKOUT,
  field: "create",
  slotIndex: 0,
  position: MAX_WARMUPS,
  exerciseId: EXERCISE,
  warmup: false,
  weightKg: 100,
  reps: 5,
  rir: 2,
  doneAt: AT,
  at: AT,
  ...over,
});
const setValues = (over: Fields = {}) => ({
  kind: "set",
  id: SET,
  workoutId: WORKOUT,
  field: "values",
  weightKg: 100,
  reps: 5,
  rir: 2,
  at: AT,
  ...over,
});
const timedSet = { exerciseId: TIMED, reps: null, seconds: 45, rir: null };
const warmupSet = { position: 0, warmup: true, rir: null, weightKg: 60 };

const step = SET_KG.step;
const text = (n: number) => "x".repeat(n);
// Two UTF-16 units each: the bounds count units, as the database does.
const emoji = (n: number) => "\u{1F4AA}".repeat(n);

const changes: Record<string, unknown> = {
  "start: as the phone writes it": start(),
  "start: no session id nor name, as an older phone": start({
    sessionId: undefined,
    sessionName: undefined,
  }),
  "start: session id and name null": start({ sessionId: null, sessionName: null }),
  "start: session code Z": start({ sessionCode: "Z" }),
  "start: session code lower case": start({ sessionCode: "a" }),
  "start: session code of two letters": start({ sessionCode: "AB" }),
  "start: session id in upper case": start({ sessionId: SESSION.toUpperCase() }),
  "start: session name at its bound": start({ sessionName: text(SESSION_NAME_MAX) }),
  "start: session name one past": start({ sessionName: text(SESSION_NAME_MAX + 1) }),
  "start: session name in emoji at its bound": start({ sessionName: emoji(SESSION_NAME_MAX / 2) }),
  "start: session name in emoji one past": start({ sessionName: emoji(SESSION_NAME_MAX / 2 + 1) }),
  "start: session name empty": start({ sessionName: "" }),
  "start: session name with a leading space": start({ sessionName: " Push" }),
  "start: session name ending in a no-break space": start({ sessionName: "Push\u00a0" }),
  "start: session name ending in a byte order mark": start({ sessionName: "Push\ufeff" }),
  "start: session name with a control character": start({ sessionName: "Pu\u0007sh" }),
  "start: session name with an inner space": start({ sessionName: "Push day" }),
  "start: started at the floor": start({ startedAt: MIN_TIME }),
  "start: started one millisecond before the floor": start({ startedAt: iso(MIN_MS - 1) }),
  "start: started at its change": start({ startedAt: AT }),
  "start: started one millisecond after its change": start({ startedAt: iso(T0 + 1) }),
  "start: started without milliseconds": start({ startedAt: "2026-11-06T09:00:00Z" }),
  "start: empty plan": start({ plan: [] }),
  "start: plan at its bound": start({ plan: Array.from({ length: MAX_SLOTS }, () => slot) }),
  "start: plan one past": start({ plan: Array.from({ length: MAX_SLOTS + 1 }, () => slot) }),
  "start: timed slot at its bound": start({
    plan: [{ ...timedSlot, repRange: [1, SLOT_BOUNDS.seconds] }],
  }),
  "start: timed slot one past": start({
    plan: [{ ...timedSlot, repRange: [1, SLOT_BOUNDS.seconds + 1] }],
  }),
  "slot: one set": withSlot({ sets: 1 }),
  "slot: no set": withSlot({ sets: 0 }),
  "slot: sets at their bound": withSlot({ sets: SLOT_BOUNDS.sets }),
  "slot: sets one past": withSlot({ sets: SLOT_BOUNDS.sets + 1 }),
  "slot: reps at their bounds": withSlot({ repRange: [1, SLOT_BOUNDS.reps] }),
  "slot: reps from zero": withSlot({ repRange: [0, 5] }),
  "slot: reps one past": withSlot({ repRange: [1, SLOT_BOUNDS.reps + 1] }),
  "slot: reps the wrong way round": withSlot({ repRange: [6, 5] }),
  "slot: reps of three numbers": withSlot({ repRange: [5, 6, 7] }),
  "slot: rir at its bounds": withSlot({ rirTarget: [0, RIR_MAX] }),
  "slot: rir one past": withSlot({ rirTarget: [0, RIR_MAX + 1] }),
  "slot: rest at its bound": withSlot({ restSec: SLOT_BOUNDS.restSec }),
  "slot: rest one past": withSlot({ restSec: SLOT_BOUNDS.restSec + 1 }),
  "slot: warm-ups at their bound": withSlot({ warmupSets: MAX_WARMUPS }),
  "slot: warm-ups one past": withSlot({ warmupSets: MAX_WARMUPS + 1 }),
  "slot: no main flag": withSlot({ isMain: undefined }),
  "slot: no group key": withSlot({ groupKey: undefined }),
  "slot: group key": withSlot({ groupKey: "A1" }),
  "slot: group key at its bound": withSlot({ groupKey: text(SLOT_BOUNDS.groupKey) }),
  "slot: group key one past": withSlot({ groupKey: text(SLOT_BOUNDS.groupKey + 1) }),
  "slot: group key with a dash": withSlot({ groupKey: "a-b" }),
  "slot: measure in reps": withSlot({ measure: "reps" }),
  "slot: measure null": withSlot({ measure: null }),
  "slot: climbing rule": withSlot({ rule: "no_climbing" }),
  "slot: another rule": withSlot({ rule: "rest" }),
  "slot: added": withSlot({ added: true }),
  "slot: added false": withSlot({ added: false }),
  "slot: added null": withSlot({ added: null }),
  "slot: skipped": withSlot({ skipped: true }),
  "slot: put back": withSlot({ skipped: false }),
  "slot: unknown exercise id shape": withSlot({ exerciseId: "bench" }),
  "slot: exercise id at its bound": withSlot({ exerciseId: `ds:${text(40)}` }),
  "slot: exercise id one past": withSlot({ exerciseId: `ds:${text(41)}` }),
  "plan: replaced": workout("plan", plan(slot, { ...slot, isMain: false, groupKey: "B" })),
  "plan: empty": workout("plan", []),
  "plan: not a list": workout("plan", slot),
  "startedAt: corrected": workout("startedAt", iso(T0 - 3_600_000)),
  "startedAt: at the floor": workout("startedAt", MIN_TIME),
  "startedAt: before the floor": workout("startedAt", iso(MIN_MS - 1)),
  "startedAt: after its change": workout("startedAt", iso(T0 + 1)),
  "ended: at its change": workout("ended", AT),
  "ended: reopened": workout("ended", null),
  "ended: after its change": workout("ended", iso(T0 + 1)),
  "note: cleared": workout("note", null),
  "note: written": workout("note", "Bonne séance"),
  "note: empty": workout("note", ""),
  "note: blank": workout("note", "   "),
  "note: no-break spaces only": workout("note", "\u00a0\u00a0"),
  "note: at its bound": workout("note", text(NOTE_MAX)),
  "note: one past": workout("note", text(NOTE_MAX + 1)),
  "note: emoji at its bound": workout("note", emoji(NOTE_MAX / 2)),
  "note: emoji one past": workout("note", emoji(NOTE_MAX / 2 + 1)),
  "exerciseNotes: none": workout("exerciseNotes", {}),
  "exerciseNotes: first and last slot": workout("exerciseNotes", { "0": "a", "29": "b" }),
  "exerciseNotes: slot one past": workout("exerciseNotes", { [String(MAX_SLOTS)]: "a" }),
  "exerciseNotes: slot with a leading zero": workout("exerciseNotes", { "01": "a" }),
  "exerciseNotes: empty note": workout("exerciseNotes", { "0": "" }),
  "exerciseNotes: note at its bound": workout("exerciseNotes", { "3": text(NOTE_MAX) }),
  "exerciseNotes: note one past": workout("exerciseNotes", { "3": text(NOTE_MAX + 1) }),
  "exerciseNotes: a list": workout("exerciseNotes", ["a"]),
  "removed: true": workout("removed", true),
  "removed: false": workout("removed", false),
  "removed: not a boolean": workout("removed", 1),
  "workout: id in upper case": workout("removed", true, { id: WORKOUT.toUpperCase() }),
  "workout: id of version 4": workout("removed", true, {
    id: "6f1c2a4e-3b5d-4e7f-8a9b-0c1d2e3f4a5b",
  }),
  "workout: nil id": workout("removed", true, { id: "00000000-0000-0000-0000-000000000000" }),
  "workout: unknown field": workout("rating", 5),
  "at: without milliseconds": workout("removed", true, { at: "2026-11-06T09:30:00Z" }),
  "at: with an offset": workout("removed", true, { at: "2026-11-06T10:30:00.123+01:00" }),
  "at: not a time": workout("removed", true, { at: "yesterday" }),
  "at: day past the month's end": workout("removed", true, { at: "2026-02-30T00:00:00.000Z" }),
  "at: the epoch": workout("removed", true, { at: iso(0) }),
  "set: as the phone writes it": createSet(),
  "set: seconds null": createSet({ seconds: null }),
  "set: no load": createSet({ weightKg: SET_KG.min }),
  "set: load at its bound": createSet({ weightKg: SET_KG.max }),
  "set: load one step past": createSet({ weightKg: SET_KG.max + step }),
  "set: load one step": createSet({ weightKg: step }),
  "set: load on the grid": createSet({ weightKg: 102.75 }),
  "set: load off the grid": createSet({ weightKg: 0.1 }),
  "set: load half a step": createSet({ weightKg: step / 2 }),
  "set: load below zero": createSet({ weightKg: -step }),
  "set: load within the grid's tolerance": createSet({ weightKg: step + 1e-7 }),
  "set: load past the grid's tolerance": createSet({ weightKg: step + 1e-5 }),
  "set: load as text": createSet({ weightKg: "100" }),
  "set: no rep": createSet({ reps: REPS.min }),
  "set: reps at their bound": createSet({ reps: REPS.max }),
  "set: reps one past": createSet({ reps: REPS.max + 1 }),
  "set: reps below zero": createSet({ reps: -1 }),
  "set: reps not whole": createSet({ reps: 2.5 }),
  "set: neither reps nor seconds": createSet({ reps: null }),
  "set: timed": createSet(timedSet),
  "set: timed at no second": createSet({ ...timedSet, seconds: SECONDS.min }),
  "set: timed at its bound": createSet({ ...timedSet, seconds: SECONDS.max }),
  "set: timed one past": createSet({ ...timedSet, seconds: SECONDS.max + 1 }),
  "set: timed with a rir": createSet({ ...timedSet, rir: 1 }),
  "set: reps and seconds": createSet({ ...timedSet, reps: 5 }),
  "set: rir null": createSet({ rir: null }),
  "set: rir zero": createSet({ rir: 0 }),
  "set: rir at its bound": createSet({ rir: RIR_MAX }),
  "set: rir one past": createSet({ rir: RIR_MAX + 1 }),
  "set: rir below zero": createSet({ rir: -1 }),
  "set: first slot": createSet({ slotIndex: 0 }),
  "set: last slot": createSet({ slotIndex: MAX_SLOTS - 1 }),
  "set: slot one past": createSet({ slotIndex: MAX_SLOTS }),
  "set: slot below zero": createSet({ slotIndex: -1 }),
  "set: first warm-up": createSet(warmupSet),
  "set: last warm-up": createSet({ ...warmupSet, position: MAX_WARMUPS - 1 }),
  "set: warm-up at a work position": createSet({ ...warmupSet, position: MAX_WARMUPS }),
  "set: work set at a warm-up position": createSet({ position: MAX_WARMUPS - 1 }),
  "set: warm-up with a rir": createSet({ ...warmupSet, rir: 1 }),
  "set: warm-up timed": createSet({ ...warmupSet, ...timedSet }),
  "set: last position": createSet({ position: MAX_POSITION }),
  "set: position one past": createSet({ position: MAX_POSITION + 1 }),
  "set: done at the floor": createSet({ doneAt: MIN_TIME }),
  "set: done before the floor": createSet({ doneAt: iso(MIN_MS - 1) }),
  "set: done after its change": createSet({ doneAt: iso(T0 + 1) }),
  "set: unknown exercise id shape": createSet({ exerciseId: "ds:Bench" }),
  "set: session id in upper case": createSet({ workoutId: WORKOUT.toUpperCase() }),
  "set: id of version 8": createSet({ id: "019a5a3c-7b2e-8d41-9c3f-2b8e4d6a1f02" }),
  "set: id of version 9": createSet({ id: "019a5a3c-7b2e-9d41-9c3f-2b8e4d6a1f02" }),
  "values: corrected": setValues({ weightKg: 102.5, reps: 6, rir: 1 }),
  "values: seconds null": setValues({ seconds: null }),
  "values: timed": setValues({ reps: null, seconds: 30, rir: null }),
  "values: timed with a rir": setValues({ reps: null, seconds: 30 }),
  "values: off the grid": setValues({ weightKg: 100.1 }),
  "values: neither reps nor seconds": setValues({ reps: null }),
  "set removed: true": {
    kind: "set",
    id: SET,
    workoutId: WORKOUT,
    field: "removed",
    value: true,
    at: AT,
  },
  "set removed: not a boolean": {
    kind: "set",
    id: SET,
    workoutId: WORKOUT,
    field: "removed",
    value: "yes",
    at: AT,
  },
  "set: unknown field": { kind: "set", id: SET, workoutId: WORKOUT, field: "moved", at: AT },
};

const SECOND = "2026-11-06T09:30:00";
const merge = {
  isNewer: [
    [AT, null],
    [AT, AT],
    [iso(T0 + 1), AT],
    [iso(T0 - 1), AT],
    [`${SECOND}Z`, `${SECOND}.000Z`],
    [`${SECOND}.001Z`, `${SECOND}Z`],
    ["2026-11-06T10:30:00.124+01:00", AT],
    ["2026-11-06T10:30:00.123+01:00", AT],
    ["2026-11-06T09:30Z", `${SECOND}.000Z`],
    [`${SECOND}.5Z`, `${SECOND}.499Z`],
    [MIN_TIME, null],
    [iso(MIN_MS - 1), MIN_TIME],
    [MIN_TIME, iso(MIN_MS - 1)],
    ["yesterday", AT],
    [AT, "yesterday"],
    ["yesterday", null],
    ["2026-11-06T09:30:60.000Z", AT],
  ].map(([incoming, existing]) => ({
    incoming,
    existing,
    newer: isNewer(incoming!, existing ?? null),
  })),
  clampAt: [
    [iso(T0 - 1), AT],
    [AT, AT],
    [iso(T0 + 1), AT],
    [iso(T0 + CLOCK_SLACK_MS), AT],
    [iso(T0 + CLOCK_SLACK_MS + 1), AT],
    [`${SECOND}Z`, AT],
    ["2026-11-06T10:31:00.000+01:00", AT],
    [MIN_TIME, AT],
    ["yesterday", AT],
  ].map(([at, now]) => ({ at, now, result: clampAt(at!, new Date(now!)) })),
};

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// The id rule as validity applies it, read through a change so the vector follows valid.ts.
const isIdOf = (id: string) => isValidChange(workout("removed", true, { id }) as Change);
const ids = [
  WORKOUT,
  WORKOUT.toUpperCase(),
  "6f1c2a4e-3b5d-4e7f-8a9b-0c1d2e3f4a5b",
  "019a5a3c-7b2e-0d41-9c3f-2b8e4d6a1f00",
  "019a5a3c-7b2e-7d41-cc3f-2b8e4d6a1f00",
  "019a5a3c-7b2e-7d41-7c3f-2b8e4d6a1f00",
  "019a5a3c7b2e7d419c3f2b8e4d6a1f00",
  "{019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f00}",
  "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f0",
  "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f000",
  "019a5a3g-7b2e-7d41-9c3f-2b8e4d6a1f00",
  "00000000-0000-0000-0000-000000000000",
].map((id) => {
  if (ID.test(id) !== isIdOf(id)) throw new Error(`the id rule moved: ${id}`);
  return { id, valid: isIdOf(id) };
});

const instants = [
  0,
  T0,
  -1,
  MIN_MS,
  MIN_MS - 1,
  Date.UTC(2024, 1, 29, 23, 59, 59, 999),
  Date.UTC(9999, 11, 31, 23, 59, 59, 999),
  Date.UTC(10_000, 0, 1),
  // Date.UTC reads years 0 to 99 as 1900 to 1999.
  new Date(0).setUTCFullYear(0, 0, 1) - 1,
  Date.UTC(-1, 0, 1),
  Date.UTC(1600, 1, 29, 12),
].map((ms) => ({ ms, iso: iso(ms) }));

const cases = Object.entries(changes).map(([name, change]) => {
  const valid = isValidChange(change as Change);
  const json = JSON.stringify(change);
  // The phone's rule is a subset of the server's, and a change it accepts reaches the server
  // as written: a case where either is not so would test the wrong thing.
  const parsed = ChangeSchema.safeParse(JSON.parse(json));
  if (valid && !(parsed.success && isDeepStrictEqual(parsed.data, JSON.parse(json))))
    throw new Error(`accepted on the phone, not by the server as written: ${name}`);
  return { name, valid, json };
});

const vectors = {
  bounds: {
    setKg: SET_KG,
    reps: REPS,
    seconds: SECONDS,
    rirMax: RIR_MAX,
    maxSlots: MAX_SLOTS,
    maxPosition: MAX_POSITION,
    maxWarmups: MAX_WARMUPS,
    noteMax: NOTE_MAX,
    sessionNameMax: SESSION_NAME_MAX,
    planMaxBytes: PLAN_MAX_BYTES,
    slot: SLOT_BOUNDS,
    exerciseId: EXERCISE_ID.source,
    minTime: MIN_TIME,
    clockSlackMs: CLOCK_SLACK_MS,
    maxChanges: MAX_CHANGES,
  },
  changes: cases,
  ...merge,
  ids,
  instants,
};
// The session rules. Sessions and sets are written as the store keeps them, so the native core
// reads them as rows: every row field there, a set's time of change at its own time.
type Done = {
  id: string;
  sessionCode: string;
  sessionId?: string | null;
  startedAt: string;
  endedAt: string | null;
  removed: boolean;
} & Partial<Workout>;
const asRow = (w: Done & { startedAtAt?: string | null }) => ({
  plan: [],
  note: null,
  exerciseNotes: {},
  ...w,
});
const asSetRow = (s: WorkoutSet) => ({ ...s, fieldsAt: s.doneAt });
const asHistory = (h: History) => ({ workouts: h.workouts.map(asRow), sets: h.sets.map(asSetRow) });

const START_A = sessionByCode("A", starterProgram)!.slots;
const START_B = sessionByCode("B", starterProgram)!.slots;
const START_C = sessionByCode("C", starterProgram)!.slots;
const BENCH = "ds:0025";
const HANG = "belay:dead-hang";

let serial = 0;
const session = (patch: Partial<Workout> & { startedAtAt?: string | null } = {}) => ({
  id: seedId(0x1000 + ++serial),
  sessionCode: "A",
  plan: [...START_A],
  startedAt: "2026-10-05T17:00:00.000Z",
  endedAt: "2026-10-05T18:05:00.000Z" as string | null,
  note: null,
  exerciseNotes: {},
  removed: false,
  ...patch,
});
const done = (
  w: { id: string; startedAt: string },
  round: number,
  weightKg: number,
  reps: number | null,
  patch: Partial<WorkoutSet> = {},
): WorkoutSet => ({
  id: seedId(0x2000 + ++serial),
  workoutId: w.id,
  slotIndex: 0,
  position: workPosition(round),
  exerciseId: BENCH,
  warmup: false,
  weightKg,
  reps,
  rir: 1,
  doneAt: w.startedAt,
  removed: false,
  ...patch,
});
const warm = (w: { id: string; startedAt: string }, position: number, kg: number, reps: number) =>
  done(w, 0, kg, reps, { position, warmup: true });
const timed = (w: { id: string; startedAt: string }, round: number, seconds: number) =>
  done(w, round, 0, null, { exerciseId: HANG, seconds, rir: null });

const skip = (plan: readonly Slot[], ...skipped: number[]) =>
  plan.map((s, i) => (skipped.includes(i) ? { ...s, skipped: true } : s));
const hang: Slot = {
  exerciseId: HANG,
  measure: "seconds",
  sets: 3,
  repRange: [20, 45],
  rirTarget: [0, 0],
  restSec: 60,
  warmupSets: 0,
  isMain: false,
  groupKey: null,
};
const PLANS: Record<string, Slot[]> = {
  "session A": [...START_A],
  "session B": [...START_B],
  "session C": [...START_C],
  "session C, its group's middle slot skipped": skip(START_C, 4),
  "session C, its group's last slot skipped": skip(START_C, 5),
  "session A, a main lift skipped": skip(START_A, 1),
  "session A, its whole group skipped": skip(START_A, 3, 4, 5),
  "session A with a timed slot added": [...START_A, { ...hang, added: true }],
  "a superset of two and three sets": [
    { ...hang, exerciseId: BENCH, measure: undefined, sets: 2, restSec: 0, groupKey: "1" },
    { ...hang, sets: 3, restSec: 90, groupKey: "1" },
  ],
  "two groups of one key apart": [
    { ...hang, sets: 2, restSec: 0, groupKey: "4" },
    { ...hang, sets: 2, restSec: 45, groupKey: "4" },
    { ...hang, sets: 1, restSec: 30, groupKey: null },
    { ...hang, sets: 2, restSec: 75, groupKey: "4" },
  ],
  "no slot": [],
};
const turn = (slotIndex: number, round: number) => ({ slotIndex, round });

function rulesVectors() {
  const plans = Object.entries(PLANS);
  const workOrderCases = plans.map(([name, plan]) => ({ name, plan, result: workOrder(plan) }));

  const all = (plan: readonly Slot[]) => workOrder(plan).map(turnKey);
  const nextTurnCases = [
    ["nothing done", START_A, [], undefined],
    ["after the first set", START_A, ["0|0"], turn(0, 0)],
    ["inside a superset: the partner comes next", START_A, ["3|0"], turn(3, 0)],
    ["inside a superset: the third of the round", START_A, ["3|0", "4|0"], turn(4, 0)],
    ["after a superset's round: the next round", START_A, ["3|0", "4|0", "5|0"], turn(5, 0)],
    ["a skipped slot's turn left", START_C, ["3|0", "4|0", "3|1", "4|1"], turn(4, 1)],
    ["back to one left behind", START_B, all(START_B).filter((k) => k !== "0|1"), turn(6, 2)],
    ["from a turn not in the order", skip(START_A, 1), ["0|0"], turn(1, 0)],
    ["every set done", START_A, all(START_A), turn(5, 2)],
    ["the middle of a group skipped", skip(START_C, 4), ["3|0"], turn(3, 0)],
    ["sets of two and three", PLANS["a superset of two and three sets"]!, ["0|1"], turn(0, 1)],
    ["no slot", [], [], undefined],
  ].map(([name, plan, keys, from]) => ({
    name,
    plan,
    done: keys,
    from,
    result: nextTurn(plan as Slot[], new Set(keys as string[]), from as Turn | undefined),
  }));

  const open = () => session({ endedAt: null });
  const w = open();
  const progressCases = [
    ["nothing done", START_A, []],
    [
      "two sets and a warm-up",
      START_A,
      [
        done(w, 0, 60, 8, { doneAt: "2026-10-05T17:05:00.000Z" }),
        done(w, 1, 60, 8, { doneAt: "2026-10-05T17:08:00.000Z" }),
        warm(w, 0, 20, 10),
      ],
    ],
    [
      "a skipped slot and a set past the plan",
      skip(START_A, 1),
      [done(w, 0, 60, 8, { slotIndex: 1 }), done(w, START_A[0]!.sets, 60, 8, { slotIndex: 0 })],
    ],
    [
      "every set done",
      START_A,
      workOrder(START_A).map((t) => done(w, t.round, 60, 8, { slotIndex: t.slotIndex })),
    ],
    [
      "inside a superset",
      START_A,
      [
        done(w, 0, 60, 8, { slotIndex: 3, doneAt: "2026-10-05T17:20:00.000Z" }),
        done(w, 0, 60, 8, { slotIndex: 4, doneAt: "2026-10-05T17:21:00.000Z" }),
      ],
    ],
    [
      "done out of order: the last done counts",
      START_A,
      [
        done(w, 0, 60, 8, { slotIndex: 2, doneAt: "2026-10-05T17:30:00.000Z" }),
        done(w, 0, 60, 8, { slotIndex: 0, doneAt: "2026-10-05T17:10:00.000Z" }),
      ],
    ],
    [
      "two sets done at the same time",
      START_A,
      [
        done(w, 0, 60, 8, { slotIndex: 0, doneAt: "2026-10-05T17:10:00.000Z" }),
        done(w, 0, 60, 8, { slotIndex: 1, doneAt: "2026-10-05T17:10:00.000Z" }),
      ],
    ],
    [
      "a timed slot added",
      PLANS["session A with a timed slot added"]!,
      [timed({ ...w }, 0, 30), timed(w, 1, 30)].map((s) => ({ ...s, slotIndex: 6 })),
    ],
    ["a set on a slot the plan lacks", START_A, [done(w, 0, 60, 8, { slotIndex: 9 })]],
  ].map(([name, plan, sets]) => {
    const p = sessionProgress(plan as Slot[], sets as WorkoutSet[]);
    return {
      name,
      plan,
      sets: (sets as WorkoutSet[]).map(asSetRow),
      result: { done: [...p.done], left: p.left, last: p.last, next: p.next },
    };
  });

  const restSecCases = plans.map(([name, plan]) => ({
    name,
    plan,
    results: plan.map((_, slotIndex) => restSecAfter(plan, slotIndex)),
  }));

  const at = "2026-10-07T17:00:00.000Z";
  const restEndsCases = [
    ["a slot alone", START_A, ["0|0"], turn(0, 0), at],
    ["inside a round", START_A, ["3|0"], turn(3, 0), at],
    ["after a round", START_A, ["3|0", "4|0", "5|0"], turn(5, 0), at],
    ["a round's last exercise left", START_C, ["3|0", "4|0"], turn(4, 0), at],
    [
      "after a skipped exercise's round",
      START_C,
      ["3|0", "4|0", "5|1", "3|1", "4|1"],
      turn(5, 1),
      at,
    ],
    ["after the last set", START_A, all(START_A), turn(5, 2), at],
    ["a group whose last slot is skipped", skip(START_C, 5), ["3|0", "4|0"], turn(4, 0), at],
    ["inside a round with no rest planned", START_B, ["3|0"], turn(3, 0), at],
    [
      "no rest planned after a slot alone",
      PLANS["two groups of one key apart"]!,
      ["0|0", "1|0"],
      turn(1, 0),
      at,
    ],
    ["a timed slot", PLANS["session A with a timed slot added"]!, ["6|0"], turn(6, 0), at],
    ["past midnight", START_A, ["0|0"], turn(0, 0), "2026-10-07T23:59:00.000Z"],
    ["with an offset", START_A, ["0|0"], turn(0, 0), "2026-10-07T19:00:00.000+02:00"],
  ].map(([name, plan, keys, after, doneAt]) => ({
    name,
    plan,
    done: keys,
    after,
    doneAt,
    result: restEndsAt(plan as Slot[], new Set(keys as string[]), after as Turn, doneAt as string),
  }));

  const old = session({ startedAt: "2026-09-30T17:00:00.000Z" });
  const last = session({ startedAt: "2026-10-05T17:00:00.000Z" });
  const inProgress = session({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
  const twin = session({ startedAt: "2026-10-05T17:00:00.000Z" });
  const gone = session({ startedAt: "2026-10-06T17:00:00.000Z", removed: true });
  const history: History = {
    workouts: [old, last, inProgress, gone],
    sets: [
      done(old, 0, 77.5, 8),
      timed(old, 0, 40),
      warm(last, 0, 40, 8),
      done(last, 0, 80, 8),
      done(last, 1, 80, 8),
      done(last, 2, 80, 7),
      done(last, 3, 77.5, 6),
      done(last, 4, 80, 5, { removed: true }),
      done(last, 0, 30, 10, { slotIndex: 1, exerciseId: "ds:0405" }),
      { ...timed(last, 0, 45), seconds: undefined, reps: 12 },
      done(inProgress, 0, 85, 5),
      done(gone, 0, 90, 5),
      timed(gone, 0, 60),
    ],
  };
  const tied: History = {
    workouts: [old, last, twin],
    sets: [...history.sets, done(twin, 0, 82.5, 6)],
  };
  const empty: History = { workouts: [], sets: [] };
  const histories: [string, History][] = [
    ["a history", history],
    ["two sessions started at the same time", tied],
    ["the last session removed", { ...history, workouts: [old, { ...last, removed: true }] }],
    ["no history", empty],
  ];
  const asked: [string, number, "reps" | "seconds"][] = [
    [BENCH, 0, "reps"],
    [BENCH, 3, "reps"],
    [BENCH, 5, "reps"],
    [BENCH, -1, "reps"],
    [BENCH, 0, "seconds"],
    ["ds:0405", 0, "reps"],
    [HANG, 0, "seconds"],
    [HANG, 0, "reps"],
    ["ds:9999", 0, "reps"],
  ];
  // Each history is written once; a case names the one it reads.
  const prefillCases = histories.flatMap(([name, h]) =>
    asked.map(([exerciseId, setIndex, measure]) => ({
      name: `${name}: ${exerciseId} set ${setIndex} in ${measure}`,
      history: name,
      exerciseId,
      setIndex,
      measure,
      result: prefill(h, exerciseId, setIndex, measure),
    })),
  );
  const lastTimeCases = histories.flatMap(([name, h]) =>
    asked
      .filter(([, setIndex]) => setIndex === 0)
      .map(([exerciseId, , measure]) => ({
        name: `${name}: ${exerciseId} in ${measure}`,
        history: name,
        exerciseId,
        measure,
        result: lastTime(h, exerciseId, measure),
      })),
  );
  const liveSetsCases = histories.map(([name, h]) => ({
    name,
    history: name,
    result: liveSets(h).map((s) => s.id),
  }));

  const now = (iso: string) => new Date(iso);
  const left = session({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
  const lastSet = "2026-10-07T18:00:00.000Z";
  const leftSets = [
    done(left, 0, 80, 8, { doneAt: "2026-10-07T17:30:00.000Z" }),
    done(left, 1, 80, 8, { doneAt: lastSet }),
  ];
  const resumed = { ...left, startedAt: "2026-10-07T17:30:00.000Z" };
  const other = session({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
  const autoCloseCases = [
    ["last set 5 h 59 old", left, leftSets, "2026-10-07T23:59:00.000Z"],
    ["last set 6 h 01 old", left, leftSets, "2026-10-08T00:01:00.000Z"],
    ["last set exactly 6 h old", left, leftSets, "2026-10-08T00:00:00.000Z"],
    ["last set 6 h and a millisecond old", left, leftSets, "2026-10-08T00:00:00.001Z"],
    [
      "going on past midnight",
      left,
      [done(left, 0, 80, 8, { doneAt: "2026-10-07T22:50:00.000Z" })],
      "2026-10-07T23:10:00.000Z",
    ],
    ["no set, 5 h 59", left, [], "2026-10-07T22:59:00.000Z"],
    ["no set, 6 h 01", left, [], "2026-10-07T23:01:00.000Z"],
    ["no set, exactly 6 h", left, [], "2026-10-07T23:00:00.000Z"],
    ["no set, 6 h and a millisecond", left, [], "2026-10-07T23:00:00.001Z"],
    ["finished", session(), [], "2026-12-01T00:00:00.000Z"],
    ["removed", { ...left, removed: true }, [], "2026-12-01T00:00:00.000Z"],
    [
      "a removed set",
      left,
      [done(left, 0, 80, 8, { doneAt: lastSet, removed: true })],
      "2026-10-07T23:01:00.000Z",
    ],
    [
      "sets of another session",
      left,
      [done(other, 0, 80, 8, { doneAt: "2026-10-07T22:00:00.000Z" })],
      "2026-10-07T23:01:00.000Z",
    ],
    [
      "open on another device, its sets synced in",
      other,
      [done(other, 0, 80, 8, { doneAt: "2026-10-07T22:00:00.000Z" })],
      "2026-10-08T03:59:00.000Z",
    ],
    [
      "resumed after its last set, 6 h after the set",
      { ...resumed, startedAtAt: "2026-10-07T18:35:00.000Z" },
      leftSets,
      "2026-10-08T00:01:00.000Z",
    ],
    [
      "resumed after its last set, 6 h after the resume",
      { ...resumed, startedAtAt: "2026-10-07T18:35:00.000Z" },
      leftSets,
      "2026-10-08T00:36:00.000Z",
    ],
    [
      "a long pause",
      { ...left, startedAt: "2026-10-07T18:55:00.000Z", startedAtAt: "2026-10-07T20:00:00.000Z" },
      leftSets,
      "2026-10-08T02:01:00.000Z",
    ],
    [
      "the start moved before the last set",
      { ...resumed, startedAtAt: "2026-10-07T17:45:00.000Z" },
      leftSets,
      "2026-10-08T00:01:00.000Z",
    ],
    [
      "the start's change never written",
      { ...resumed, startedAtAt: null },
      leftSets,
      "2026-10-08T00:01:00.000Z",
    ],
  ].map(([name, workout, sets, at]) => ({
    name,
    workout: asRow(workout as Done),
    sets: (sets as WorkoutSet[]).map(asSetRow),
    now: at,
    result: autoClose(workout as Workout, sets as WorkoutSet[], now(at as string)),
  }));

  const older = session({ startedAt: "2026-10-06T17:00:00.000Z", endedAt: null });
  const newer = session({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
  const newerTwin = session({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
  const removed = session({ startedAt: "2026-10-08T17:00:00.000Z", endedAt: null, removed: true });
  const finished = session();
  const newerSet = done(newer, 0, 80, 8, { doneAt: "2026-10-07T17:10:00.000Z" });
  const openCases = [
    ["the latest open one", [older, newer, removed, finished], undefined],
    ["none open", [finished], undefined],
    ["two started at the same time", [older, newerTwin, newer], undefined],
    [
      "the latest one still going",
      [older, newer],
      { sets: [newerSet], now: "2026-10-07T20:00:00.000Z" },
    ],
    [
      "the latest one forgotten",
      [older, newer],
      { sets: [newerSet], now: "2026-10-07T23:11:00.000Z" },
    ],
    ["both forgotten", [older, newer], { sets: [newerSet], now: "2026-10-08T00:00:00.000Z" }],
    ["no session", [], { sets: [], now: "2026-10-08T00:00:00.000Z" }],
  ].map(([name, workouts, forgotten]) => {
    const f = forgotten as { sets: WorkoutSet[]; now: string } | undefined;
    const result = openWorkout(workouts as Workout[], f && { sets: f.sets, now: now(f.now) });
    return {
      name,
      workouts: (workouts as Workout[]).map(asRow),
      forgotten: f && { sets: f.sets.map(asSetRow), now: f.now },
      result: result?.id ?? null,
    };
  });

  // Records against an earlier session: a tie, an estimate past 10 reps, a warm-up, a first
  // time and a timed set. Made with ids of their own, so the cases above keep theirs.
  const own = (n: number) => seedId(0x3000 + n);
  const endedOne = (n: number, startedAt: string, endedAt: string | null): Workout =>
    ({
      id: own(n),
      sessionCode: "A",
      plan: [...START_A],
      startedAt,
      endedAt,
      note: null,
      exerciseNotes: {},
      removed: false,
    }) as Workout;
  const at_ = (w: Workout, n: number, patch: Partial<WorkoutSet>): WorkoutSet => ({
    id: own(0x100 + n),
    workoutId: w.id,
    slotIndex: 0,
    position: workPosition(0),
    exerciseId: BENCH,
    warmup: false,
    weightKg: 80,
    reps: 8,
    rir: 1,
    doneAt: w.startedAt,
    removed: false,
    ...patch,
  });
  const before = endedOne(1, "2026-09-01T17:00:00.000Z", "2026-09-01T18:00:00.000Z");
  const tie = endedOne(2, "2026-09-08T17:00:00.000Z", "2026-09-08T18:10:30.250Z");
  const better = endedOne(3, "2026-09-15T17:00:00.000Z", "2026-09-15T17:58:00.000Z");
  const later = endedOne(4, "2026-09-22T17:00:00.000Z", null);
  const records: History = {
    workouts: [before, tie, better, later],
    sets: [
      at_(before, 1, {}),
      at_(before, 2, { exerciseId: HANG, slotIndex: 6, reps: null, seconds: 30, weightKg: 0 }),
      at_(before, 3, { exerciseId: "ds:0405", slotIndex: 1, weightKg: 50, reps: 12 }),
      at_(tie, 1, {}),
      at_(tie, 2, { position: 0, warmup: true, weightKg: 100, reps: 3 }),
      at_(tie, 3, { exerciseId: "ds:0739", slotIndex: 2, weightKg: 20, reps: 10 }),
      at_(better, 1, { weightKg: 82.5, reps: 8 }),
      at_(better, 2, { position: workPosition(1), weightKg: 70, reps: 12 }),
      at_(better, 3, { exerciseId: HANG, slotIndex: 6, reps: null, seconds: 35, weightKg: 5 }),
      at_(better, 4, { exerciseId: "ds:0405", slotIndex: 1, weightKg: 52.5, reps: 10 }),
      at_(better, 5, { position: workPosition(2), weightKg: 85, reps: 8, removed: true }),
      at_(later, 1, { weightKg: 90, reps: 1 }),
      at_(later, 2, { position: workPosition(1), weightKg: 0, reps: 8 }),
    ],
  };
  histories.push(["records against earlier sessions", records]);
  const summaryCases = histories.flatMap(([name, h]) =>
    h.workouts.map((w, i) => ({
      name: `${name}: session ${i + 1}`,
      history: name,
      workoutId: w.id,
      result: summary(w, liveSets(h), h),
    })),
  );

  return {
    bounds: { forgottenMs: FORGOTTEN_MS, maxRotation: MAX_ROTATION },
    histories: Object.fromEntries(histories.map(([name, h]) => [name, asHistory(h)])),
    workOrder: workOrderCases,
    nextTurn: nextTurnCases,
    sessionProgress: progressCases,
    restSecAfter: restSecCases,
    restEndsAt: restEndsCases,
    prefill: prefillCases,
    lastTime: lastTimeCases,
    liveSets: liveSetsCases,
    autoClose: autoCloseCases,
    openWorkout: openCases,
    summary: summaryCases,
  };
}

// The schedule rules. A day is local: each case that reads one names the zone it was computed
// in, and the zones span a day either side of UTC, on a Sunday-to-Monday night and the night
// Paris leaves summer time.
const ZONES = ["Europe/Paris", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati", "UTC"];
function inZone<T>(zone: string, make: () => T): T {
  const was = process.env.TZ;
  process.env.TZ = zone;
  try {
    return make();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

const asActivity = (a: Pick<Activity, "date" | "kind" | "removed">, i: number) => ({
  id: seedId(0x3000 + i),
  date: a.date,
  type: a.kind,
  removed: a.removed,
});
const climb = (date: string, removed = false) => ({ date, kind: "climbing" as const, removed });
const cardio = (date: string) => ({ date, kind: "cardio" as const, removed: false });

// The session a rule picks, by its letter and the session it comes from; rotationOf's cases
// check the templates themselves.
const pick = (t: LetteredTemplate | null) => t && { code: t.code, sessionId: t.sessionId };

function scheduleVectors() {
  const seedRotation = rotationOf(SEED);
  const sessionA = seedRotation[0]!;
  const sessionC = seedRotation[2]!;
  const long = { ...sessionC, slots: Array.from({ length: 29 }, () => sessionC.slots[0]!) };
  const emptyRule = { ...sessionA, noClimbing: [] };
  const weeks: [string, Pick<Activity, "date" | "kind" | "removed">[]][] = [
    ["no activity", []],
    ["a climb on Wednesday", [climb(fx.WED)]],
    ["a climb removed", [climb(fx.WED, true)]],
    ["cardio only", [cardio(fx.WED)]],
    ["a climb on the Sunday summer time ends", [climb(fx.SUN)]],
    ["a climb on the next Monday", [climb(fx.NEXT_MON)]],
    ["a climb the Sunday before", [climb("2026-10-18")]],
    ["a climb on Monday", [climb(fx.MON)]],
  ];
  const dates = [fx.MON, fx.WED, fx.SUN, fx.NEXT_MON, "2026-03-29", "2026-03-30", "2027-01-01"];
  const climbedCases = weeks.flatMap(([name, activities]) =>
    dates.map((date) => ({
      name: `${name}, on ${date}`,
      activities: activities.map(asActivity),
      date,
      result: climbedThisWeek(activities, date),
    })),
  );
  // Each template is written once; a case names the one it plans.
  const templates = {
    "session C": sessionC,
    "session A, no climbing rule": sessionA,
    "an empty climbing rule": emptyRule,
    "a session past the plan's bound": long,
  };
  const planForCases = Object.entries(templates).flatMap(([name, template]) =>
    weeks.flatMap(([week, activities]) =>
      [fx.WED, fx.NEXT_MON].map((date) => ({
        name: `${name}: ${week}, on ${date}`,
        session: name,
        activities: activities.map(asActivity),
        date,
        result: planFor(template, activities, date),
      })),
    ),
  );

  const estimateCases = Object.entries({
    ...Object.fromEntries(starterProgram.map((t) => [`session ${t.code}`, t.slots])),
    ...PLANS,
    "session C with its climbing rule": planFor(sessionC, [], fx.WED),
    "one short slot": [{ ...hang, sets: 1, restSec: 0 }],
    "half way to the next 5 minutes": [{ ...hang, sets: 2, restSec: 105 }],
  }).map(([name, slots]) => ({
    name,
    slots,
    minutes: estimatedMinutes({ slots }),
    workSets: plannedWorkSets(slots),
  }));

  const seedProgram = SEED.programs[0]!;
  const seedSession = SEED.sessions[0]!;
  const seedSlot = SEED.slots[0]!;
  const extra = { ...seedSession, id: seedId(0x4001), name: "Haut", position: 3 };
  const partials: [string, Partial<StoredPrograms>][] = [
    ["nothing stored", {}],
    ["no program active", { activeId: null }],
    ["no program active, a time kept", { activeId: null, activeAt: "2026-10-20T08:00:00.000Z" }],
    ["another program active", { activeId: fx.P2, activeAt: "2026-10-20T08:00:00.000Z" }],
    ["another program active, no time", { activeId: fx.P2 }],
    ["the seed program renamed", { programs: [{ ...seedProgram, name: "Force" }] }],
    ["a session added", { sessions: [extra] }],
    ["a seed slot removed", { slots: [{ ...seedSlot, removed: true }] }],
    [
      "a fixed week stored",
      { programs: [{ ...seedProgram, schedule: { mode: "fixed", days: fx.MWS.days } }] },
    ],
  ];
  const withSeedCases = partials.map(([name, stored]) => ({
    name,
    stored,
    result: withSeed(stored),
  }));

  const base = fx.stored(4);
  const many = fx.stored(MAX_ROTATION + 1);
  const programs: [string, StoredPrograms][] = [
    ["the seed", SEED],
    ["four sessions", base],
    [
      "a reorder",
      {
        ...base,
        sessions: base.sessions.map((s) =>
          s.id === fx.S(0) ? { ...s, position: 1 } : s.id === fx.S(1) ? { ...s, position: 0 } : s,
        ),
      },
    ],
    [
      "two sessions at one position, by id",
      { ...base, sessions: base.sessions.map((s) => ({ ...s, position: 7 })).reverse() },
    ],
    [
      "a session set aside, one removed, one emptied, one in the other program",
      {
        ...base,
        sessions: base.sessions.map((s, i) =>
          i === 0
            ? { ...s, programId: null }
            : i === 1
              ? { ...s, removed: true }
              : i === 2
                ? { ...s, programId: fx.P2 }
                : s,
        ),
        slots: base.slots.filter((s) => s.sessionId !== fx.S(3)),
      },
    ],
    [
      "a session with only its climbing rule",
      {
        ...base,
        slots: base.slots.map((s, i) => (i === 0 ? { ...s, rule: "no_climbing" as const } : s)),
      },
    ],
    [
      "slots in order, a timed one, a removed one, a climbing rule",
      {
        ...base,
        slots: [
          ...base.slots,
          { ...base.slots[0]!, id: seedId(0x5001), position: 2, measure: "seconds" as const },
          { ...base.slots[0]!, id: seedId(0x5002), position: 1, removed: true },
          { ...base.slots[0]!, id: seedId(0x5003), position: 0, rule: "no_climbing" as const },
          { ...base.slots[0]!, id: seedId(0x5004), position: 1, rule: "no_climbing" as const },
        ],
      },
    ],
    [
      "named sessions",
      { ...base, sessions: base.sessions.map((s, i) => ({ ...s, name: `S${i}` })) },
    ],
    ["no program active", { ...base, activeId: null }],
    ["an unknown program active", { ...base, activeId: fx.UNKNOWN }],
    ["the other program active", { ...base, activeId: fx.P2 }],
    [
      "the active program removed",
      { ...base, programs: base.programs.map((p) => ({ ...p, removed: true })) },
    ],
    ["more sessions than letters", many],
  ];
  const rotationCases = programs.map(([name, stored]) => ({
    name,
    stored,
    result: rotationOf(stored),
  }));

  const rotation = rotationOf(base);
  const id = (i: number) => fx.S(i);
  let day = 1;
  const finishedOn = (patch: Partial<Done>): Done => {
    const startedAt = patch.startedAt ?? `2026-10-${String(day++).padStart(2, "0")}T17:00:00.000Z`;
    return {
      id: seedId(0x6000 + day),
      sessionCode: "A",
      startedAt,
      endedAt: startedAt,
      removed: false,
      ...patch,
    };
  };
  const at = (d: string) => `2026-10-${d}T17:00:00.000Z`;
  const history = [
    finishedOn({ sessionId: id(0), startedAt: at("05") }),
    finishedOn({ sessionId: id(1), startedAt: at("07") }),
    { ...finishedOn({ sessionId: id(2), startedAt: at("08") }), endedAt: null },
    { ...finishedOn({ sessionId: id(3), startedAt: at("09") }), removed: true },
  ];
  const first = finishedOn({ id: seedId(0xf01), sessionId: id(0), startedAt: at("10") });
  const second = finishedOn({ id: seedId(0xf02), sessionId: id(1), startedAt: at("10") });
  const rotationNext: [string, Done[], string | null][] = [
    ["nothing done", [], null],
    ["by its recorded id", [finishedOn({ sessionCode: "A", sessionId: id(2) })], null],
    ["the last one wraps round", [finishedOn({ sessionCode: "C", sessionId: id(3) })], null],
    ["by its letter", [finishedOn({ sessionCode: "B" })], null],
    ["by its letter, the id null", [finishedOn({ sessionCode: "B", sessionId: null })], null],
    ["by its letter, the id empty", [finishedOn({ sessionCode: "B", sessionId: "" })], null],
    ["one open and one removed aside", history, null],
    ["a recorded one before activation", history, "2026-10-08T00:00:00.000Z"],
    [
      "a letter before activation",
      [finishedOn({ sessionCode: "B", startedAt: at("05") })],
      at("06"),
    ],
    ["a letter at activation", [finishedOn({ sessionCode: "B", startedAt: at("06") })], at("06")],
    ["the same instant, the greater id", [first, second], null],
    ["the same instant, the other order", [second, first], null],
    [
      "the same instant written with an offset",
      [first, { ...second, startedAt: "2026-10-10T19:00:00.000+02:00" }],
      null,
    ],
    ["one that left the rotation", [finishedOn({ sessionId: fx.UNKNOWN })], null],
    ["a letter the rotation lacks", [finishedOn({ sessionCode: "F" })], null],
  ];
  const nextCases = [
    ...rotationNext.map(([name, workouts, activeAt]) => ({ name, workouts, rotation, activeAt })),
    { name: "no rotation", workouts: history, rotation: [], activeAt: null },
  ].map((c) => ({
    ...c,
    workouts: c.workouts.map(asRow),
    result: pick(nextInRotation(c.workouts, c.rotation, c.activeAt)),
  }));

  const plannedCases = ZONES.flatMap((zone) =>
    inZone(zone, () => {
      const p = fx.stored(3, fx.MWS);
      const one = fx.stored(3, fx.MONDAYS);
      // Monday A, Sunday C: a session on the Sunday-to-Monday night is due or done by its day.
      const sunMon = fx.stored(3, fx.fixed([fx.S(0), null, null, null, null, null, fx.S(2)]));
      const laFallBack = fx.A("2026-11-02", {
        startedAt: "2026-11-02T07:30:00.000Z",
        endedAt: "2026-11-02T08:30:00.000Z",
      });
      const lateSunday = fx.A(fx.SUN, {
        startedAt: fx.local(fx.SUN, 23, 30),
        endedAt: fx.local(fx.NEXT_MON, 0, 30),
      });
      const utcSunday = fx.A(fx.SUN, {
        startedAt: "2026-10-25T23:30:00.000Z",
        endedAt: "2026-10-26T00:30:00.000Z",
      });
      const utcMonday = fx.A(fx.NEXT_MON, {
        startedAt: "2026-10-26T09:30:00.000Z",
        endedAt: "2026-10-26T10:30:00.000Z",
      });
      const letter = fx.did("B", null, fx.TUE);
      const list: [string, StoredPrograms, Done[], string][] = [
        ["rotation", fx.stored(3), [fx.A(fx.MON), fx.B(fx.TUE)], fx.WED],
        ["no session", fx.stored(0), [], fx.WED],
        ["fixed, due today", p, [], fx.WED],
        ["fixed, done today", p, [fx.B(fx.WED)], fx.WED],
        ["fixed, done the day before", p, [fx.A(fx.MON), fx.B(fx.TUE)], fx.WED],
        ["fixed, done on the previous session day", p, [fx.B(fx.MON)], fx.WED],
        ["fixed, done after today", p, [fx.B(fx.THU)], fx.WED],
        ["fixed, a rest day", p, [], fx.TUE],
        ["fixed, Sunday", p, [], fx.SUN],
        [
          "fixed, open and removed aside",
          p,
          [fx.B(fx.WED, { endedAt: null }), fx.B(fx.WED, { removed: true })],
          fx.WED,
        ],
        ["one day a week, done last Tuesday", one, [fx.A(fx.TUE)], fx.NEXT_MON],
        ["one day a week, done last Monday", one, [fx.A(fx.MON)], fx.NEXT_MON],
        [
          "started late on the Sunday summer time ends",
          sunMon,
          [fx.A(fx.MON), lateSunday],
          fx.NEXT_MON,
        ],
        ["started on Sunday night in UTC", sunMon, [fx.A(fx.MON), utcSunday], fx.NEXT_MON],
        ["started on Monday morning in UTC", sunMon, [fx.A(fx.MON), utcMonday], fx.NEXT_MON],
        ["the night Los Angeles leaves summer time", sunMon, [laFallBack], "2026-11-02"],
        [
          "by letter, before activation",
          { ...p, activeAt: fx.local(fx.TUE, 19) },
          [letter],
          fx.WED,
        ],
        ["by letter, after activation", { ...p, activeAt: fx.local(fx.TUE, 12) }, [letter], fx.WED],
        ["another letter", p, [fx.did("C", null, fx.TUE)], fx.WED],
      ];
      return list.map(([name, stored, workouts, today]) => ({
        name: `${zone}: ${name}`,
        timeZone: zone,
        stored,
        workouts: workouts.map(asRow),
        today,
        result: pick(plannedNext(workouts, stored, rotationOf(stored), today)),
      }));
    }),
  );

  return {
    templates,
    climbedThisWeek: climbedCases,
    planFor: planForCases,
    estimates: estimateCases,
    withSeed: withSeedCases,
    rotationOf: rotationCases,
    nextInRotation: nextCases,
    plannedNext: plannedCases,
  };
}

// The session's tools: loading a bar, warm-ups, the day's plan edited, a pause. Loads span under
// the bar to past the plate table's bound, on three kinds of equipment.
const BARBELL = {
  id: "ds:0025",
  name: "Barbell bench press",
  equipment: "barbell",
  incrementKg: 2.5,
  measure: "reps",
} as const;
const DUMBBELL = {
  id: "ds:0405",
  name: "Dumbbell curl",
  equipment: "dumbbell",
  incrementKg: 2,
  measure: "reps",
} as const;
const BODYWEIGHT = {
  id: "ds:0739",
  name: "Pull-up",
  equipment: "bodyweight",
  incrementKg: 2.5,
  measure: "reps",
} as const;
const HOLD = {
  id: HANG,
  name: "Dead hang",
  equipment: "bodyweight",
  incrementKg: 2.5,
  measure: "seconds",
} as const;
const LOADS = [10, 20, 60, 100, 140, MAX_TARGET_KG + 0.5];
const COUNTS: WarmupCount[] = [0, 1, 2, 3];

function toolVectors() {
  const presets = Object.entries(PLATE_PRESETS);
  const nearestCases = presets.flatMap(([preset, { barKg, platesKg }]) =>
    [0, 10, 20, 21, 22.5, 23.75, 41.2, 60, 61.25, 100, 101, 140, 333.3, MAX_TARGET_KG].map(
      (targetKg) => ({
        name: `${preset}: ${targetKg} kg`,
        targetKg,
        barKg,
        platesKg,
        result: nearestLoading(targetKg, barKg, platesKg),
      }),
    ),
  );
  const gym = PLATE_PRESETS.gym;
  const warmupSetsCases = [...LOADS.slice(0, -1), 47.5, 250].flatMap((workKg) =>
    COUNTS.map((count) => ({
      name: `${workKg} kg, ${count} sets`,
      workKg,
      count,
      barKg: gym.barKg,
      platesKg: gym.platesKg,
      result: warmupSets(workKg, count, gym.barKg, gym.platesKg),
    })),
  );
  const warmupsCases = [BARBELL, DUMBBELL, BODYWEIGHT].flatMap((exercise) =>
    [null, 0, 3, ...LOADS, 47.3].flatMap((workKg) =>
      COUNTS.map((count) => ({
        name: `${exercise.equipment}: ${workKg} kg, ${count} sets`,
        slot: { ...slot, warmupSets: count },
        workKg,
        exercise,
        bar: gym,
        result: warmups({ warmupSets: count }, workKg, exercise, gym),
      })),
    ),
  );

  const timedSkipped = [...START_A.slice(0, 2), { ...hang, skipped: true }, START_A[2]!];
  const plans: [string, Slot[]][] = [
    ["session A", [...START_A]],
    ["a slot skipped and one put back", [...skip(START_A, 1), { ...START_A[2]!, skipped: false }]],
    ["a timed slot skipped", timedSkipped],
    ["no slot", []],
  ];
  const liveSlotsCases = plans.map(([name, plan]) => ({ name, plan, result: liveSlots(plan) }));
  const exercises = { BARBELL, DUMBBELL, BODYWEIGHT, HOLD };
  const replaceCases = [
    ["reps by reps", START_A, 0, BARBELL],
    ["reps by seconds", START_A, 1, HOLD],
    ["seconds by reps", timedSkipped, 2, DUMBBELL],
    ["seconds by seconds", timedSkipped, 2, HOLD],
    ["in a group", START_A, 4, BODYWEIGHT],
    ["past the plan", START_A, 9, BARBELL],
  ].map(([name, plan, at, exercise]) => ({
    name,
    plan,
    at,
    exercise,
    result: replaceSlot(plan as Slot[], at as number, exercise as typeof BARBELL),
  }));
  const next = nextTurn(START_A, new Set(["0|0", "0|1", "0|2"]), turn(0, 2))!.slotIndex;
  const skipCases = [
    ["the next slot", START_A, next, true],
    ["put back", skip(START_A, next), next, false],
    ["a group's middle", START_C, 4, true],
    ["past the plan", START_A, 9, true],
  ].map(([name, plan, at, skipped]) => ({
    name,
    plan,
    at,
    skipped,
    result: skipSlot(plan as Slot[], at as number, skipped as boolean),
  }));
  const sized = (n: number) => Array.from({ length: n }, (_, i) => START_A[i % START_A.length]!);
  const appendCases = [
    ["reps", START_A, BARBELL],
    ["seconds", START_A, HOLD],
    ["to no slot", [], DUMBBELL],
    [`at ${MAX_SLOTS - 1} slots`, sized(MAX_SLOTS - 1), BARBELL],
    [`at ${MAX_SLOTS} slots`, sized(MAX_SLOTS), BARBELL],
  ].map(([name, plan, exercise]) => {
    let result: Slot[] | null;
    try {
      result = appendSlot(plan as Slot[], exercise as typeof BARBELL);
    } catch {
      result = null; // full
    }
    return { name, plan, exercise, result };
  });

  // A session started at 17:00, paused at 17:20 and resumed at 17:30, in every variation.
  const S = "2026-10-07T17:00:00.000Z";
  const P = "2026-10-07T17:20:00.000Z";
  const R = "2026-10-07T17:30:00.000Z";
  const t = (m: number) => iso(Date.parse(S) + m * 60_000);
  const elapsedCases = [
    ["running", S, null, t(45)],
    ["paused", S, P, t(45)],
    ["a start moved past the pause elsewhere", t(25), P, t(45)],
    ["a clock put back before the start", S, null, t(-5)],
  ].map(([name, startedAt, pausedAt, now]) => ({
    name,
    startedAt,
    pausedAt,
    now,
    result: sessionElapsed(startedAt!, pausedAt, Date.parse(now!)),
  }));
  const resumedStartCases = [
    ["a pause of ten minutes", S, P, R],
    ["a clock put back during the pause", S, P, t(10)],
    ["the start moved past the pause elsewhere", t(25), P, t(40)],
    ["the start moved past the resume elsewhere", t(35), P, R],
    ["paused before the start", S, t(-10), t(5)],
    ["resumed at once", S, P, P],
  ].map(([name, startedAt, pausedAt, resumedAt]) => ({
    name,
    startedAt,
    pausedAt,
    resumedAt,
    result: resumedStart(startedAt!, pausedAt!, resumedAt!),
  }));
  const endedByCases = [
    ["no set", []],
    ["a set before the pause", [t(10)]],
    ["a set at the pause", [P]],
    ["a set after the pause", [t(10), t(25)]],
    ["two after, the later first", [t(28), t(25), t(15)]],
  ].map(([name, doneAts]) => ({
    name,
    pausedAt: P,
    doneAts,
    result: pauseEndedBy(P, doneAts as string[]),
  }));
  const STOPS: PauseStops[] = ["all", "session"];
  const restClockCases = STOPS.flatMap((stops) =>
    [
      ["running", null, t(25)],
      ["paused", P, t(25)],
      ["a clock put back during the pause", P, t(15)],
    ].map(([name, pausedAt, now]) => ({
      name: `${stops}: ${name}`,
      pausedAt,
      now,
      stops,
      result: iso(restClock(pausedAt, Date.parse(now!), stops)),
    })),
  );
  const restEndCases = STOPS.flatMap((stops) =>
    [
      ["no rest", null, R],
      ["a rest running at the pause", t(21), R],
      ["a rest over before the pause", t(19), R],
      ["a rest ending at the pause", P, R],
      ["a clock put back during the pause", t(21), t(15)],
    ].map(([name, restEndsAt, resumedAt]) => ({
      name: `${stops}: ${name}`,
      restEndsAt,
      pausedAt: P,
      resumedAt,
      stops,
      result: resumedRestEnd(restEndsAt, P, resumedAt!, stops),
    })),
  );

  return {
    bounds: {
      maxTargetKg: MAX_TARGET_KG,
      platePresets: PLATE_PRESETS,
      warmupSchemes: WARMUP_SCHEMES,
      defaultWarmupCount: [0, 59.75, 60, 119.75, 120].map((workKg) => ({
        workKg,
        count: defaultWarmupCount(workKg),
      })),
    },
    exercises,
    nearestLoading: nearestCases,
    warmupSets: warmupSetsCases,
    warmups: warmupsCases,
    liveSlots: liveSlotsCases,
    replaceSlot: replaceCases,
    skipSlot: skipCases,
    appendSlot: appendCases,
    sessionElapsed: elapsedCases,
    resumedStart: resumedStartCases,
    pauseEndedBy: endedByCases,
    restClock: restClockCases,
    resumedRestEnd: restEndCases,
  };
}

// Which workouts Health should hold. Only the session part runs on the phone here: no history
// sent, no weigh-in, so those settings stay at their defaults.
function healthVectors() {
  const NOW = Date.parse("2026-10-10T12:00:00.000Z");
  const own = (n: number) => seedId(0x7000 + n);
  type Row = ReturnType<typeof asRow> & { endedAtAt?: string | null; removedAt?: string | null };
  const row = (n: number, patch: Partial<Row> = {}): Row =>
    asRow({
      id: own(n),
      sessionCode: "A",
      sessionId: null,
      startedAt: "2026-10-09T17:00:00.000Z",
      startedAtAt: "2026-10-09T17:00:00.000Z",
      endedAt: "2026-10-09T18:00:00.000Z",
      endedAtAt: "2026-10-09T18:00:00.500Z",
      removed: false,
      removedAt: null,
      ...patch,
    } as Done);
  const setOf = (w: Row, n: number, removed = false) =>
    asSetRow(done(w, n, 60, 8, { id: own(0x100 + n + (removed ? 0x80 : 0)), removed }));
  const ms = (s: string) => Date.parse(s);
  const finished = row(1);
  const open = row(2, { endedAt: null, endedAtAt: null });
  const removed = row(3, { removed: true, removedAt: "2026-10-09T19:00:00.000Z" });
  const emptied = row(4);
  const moved = row(5, {
    endedAt: "2026-10-09T18:30:00.000Z",
    endedAtAt: "2026-10-09T20:00:00.000Z",
  });
  const long = row(6, {
    startedAt: "2026-10-08T10:00:00.000Z",
    endedAt: "2026-10-09T18:00:00.000Z",
  });
  const ahead = row(7, {
    startedAt: "2026-10-11T13:00:00.000Z",
    endedAt: "2026-10-11T14:00:00.000Z",
  });
  const old = row(8, {
    startedAt: "1899-12-30T10:00:00.000Z",
    endedAt: "1899-12-30T11:00:00.000Z",
  });
  const backwards = row(9, { endedAt: "2026-10-09T17:00:00.000Z" });
  const workouts = [finished, open, removed, emptied, moved, long, ahead, old, backwards];
  const sets = [
    ...workouts.filter((w) => w !== emptied).map((w, i) => setOf(w, i)),
    setOf(emptied, 20, true),
  ];
  const span = (w: Row) => ({ startedAt: ms(w.startedAt), endedAt: ms(w.endedAt!) });
  const kept = (state: "workout" | "skipped", w: Row, version: number, over = {}): Written => ({
    state,
    version,
    ...span(w),
    ...over,
  });
  const wrote = (entries: [Row, Written][]) =>
    Object.fromEntries(entries.map(([w, k]) => [sessionKey(w.id), k]));
  const every: [Row, Written][] = workouts
    .filter((w) => w.endedAt !== null)
    .map((w) => [w, kept("workout", w, 3)]);
  const on = ms("2026-10-01T00:00:00.000Z");
  const later = ms("2026-10-09T19:00:00.000Z");
  const cases: [
    string,
    {
      on: boolean;
      turnedOnAt: number | null;
      written: Record<string, Written>;
      allowed: boolean;
      owner: string;
    },
  ][] = [
    [
      "nothing written",
      { on: true, turnedOnAt: on, written: {}, allowed: true, owner: ownerOf("u1") },
    ],
    [
      "each one written before",
      { on: true, turnedOnAt: on, written: wrote(every), allowed: true, owner: ownerOf("u1") },
    ],
    [
      "open and removed once written",
      {
        on: true,
        turnedOnAt: on,
        written: wrote([
          [open, kept("workout", finished, 2, { startedAt: 0 })],
          [removed, kept("workout", removed, 2)],
        ]),
        allowed: true,
        owner: ownerOf("u1"),
      },
    ],
    [
      "a changed end",
      {
        on: true,
        turnedOnAt: on,
        written: wrote([[moved, kept("workout", finished, 4)]]),
        allowed: true,
        owner: ownerOf("u1"),
      },
    ],
    [
      "a version past the clock",
      {
        on: true,
        turnedOnAt: on,
        written: wrote([[moved, kept("workout", finished, ms("2027-01-01T00:00:00.000Z"))]]),
        allowed: true,
        owner: ownerOf("u1"),
      },
    ],
    [
      "an overlap record, same span",
      {
        on: true,
        turnedOnAt: on,
        written: wrote([[finished, kept("skipped", finished, 1)]]),
        allowed: true,
        owner: ownerOf("u1"),
      },
    ],
    [
      "an overlap record, the span moved",
      {
        on: true,
        turnedOnAt: on,
        written: wrote([[moved, kept("skipped", finished, 1)]]),
        allowed: true,
        owner: ownerOf("u1"),
      },
    ],
    [
      "a removal record",
      {
        on: true,
        turnedOnAt: on,
        written: wrote([[finished, { state: "removed", version: 7 }]]),
        allowed: true,
        owner: ownerOf("u1"),
      },
    ],
    [
      "Health off",
      { on: false, turnedOnAt: on, written: wrote(every), allowed: true, owner: ownerOf("u1") },
    ],
    [
      "writing not allowed",
      { on: true, turnedOnAt: on, written: wrote(every), allowed: false, owner: ownerOf("u1") },
    ],
    [
      "turned on after the sessions",
      { on: true, turnedOnAt: later, written: {}, allowed: true, owner: ownerOf("u1") },
    ],
    [
      "turned on after, one written",
      {
        on: true,
        turnedOnAt: later,
        written: wrote([[moved, kept("workout", finished, 4)]]),
        allowed: true,
        owner: ownerOf("u1"),
      },
    ],
    [
      "no time turned on",
      { on: true, turnedOnAt: null, written: {}, allowed: true, owner: ownerOf("u1") },
    ],
    [
      "another owner",
      { on: true, turnedOnAt: on, written: {}, allowed: true, owner: ownerOf("u2") },
    ],
  ];
  const planCases = cases.map(([name, c]) => ({
    name,
    ...c,
    now: NOW,
    result: planHealth({
      workouts: workouts as never,
      sets: sets as never,
      weights: [],
      settings: {
        on: c.on,
        turnedOnAt: c.turnedOnAt,
        history: "no",
        importOn: false,
        importSince: null,
      },
      written: c.written,
      filled: {},
      allowed: { workouts: c.allowed, weighings: false },
      now: NOW,
      owner: c.owner,
    }),
  }));
  const spanCases = [
    ["finished", finished, 1],
    ["open", open, 1],
    ["removed", removed, 1],
    ["emptied", emptied, 0],
    ["ending at its start", backwards, 1],
  ].map(([name, w, live]) => ({
    name,
    workout: w,
    liveSets: live,
    result: finishedSpan(w as never, live as number),
  }));
  const versionCases = [
    [1000, undefined],
    [1000, 999],
    [1000, 1000],
    [1000, 5000],
  ].map(([latest, last]) => ({ latest, last: last ?? null, result: versionOf(latest!, last) }));
  const owners = ["u1", "u2", "", "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f00", "é💪"].map((userId) => ({
    userId,
    result: ownerOf(userId),
  }));
  return {
    bounds: { earliest: EARLIEST, day: DAY, sessionKey: sessionKey("x") },
    workouts,
    sets,
    planHealth: planCases,
    finishedSpan: spanCases,
    versionOf: versionCases,
    ownerOf: owners,
  };
}

const rules = rulesVectors();
const tools = toolVectors();
const files = [
  { path: core("Tests/BelayCoreTests/Vectors/contract.json"), data: vectors },
  {
    path: core("Tests/BelayCoreTests/Vectors/rules.json"),
    data: { ...rules, ...tools, bounds: { ...rules.bounds, ...tools.bounds } },
  },
  { path: core("Tests/BelayCoreTests/Vectors/health.json"), data: healthVectors() },
  { path: core("Tests/BelayCoreTests/Vectors/schedule.json"), data: scheduleVectors() },
  { path: core("Sources/BelayCore/Resources/seed.json"), data: SEED },
].map(({ path, data }) => ({ path, expected: `${JSON.stringify(data, null, 2)}\n` }));

if (process.argv.includes("--check")) {
  const stale = files.filter(({ path, expected }) => {
    try {
      return readFileSync(path, "utf8") !== expected;
    } catch {
      // A missing file is out of date.
      return true;
    }
  });
  if (stale.length > 0) {
    console.error("The native vectors are out of date. Run `pnpm vectors` and commit the result.");
    process.exit(1);
  }
  console.log(`The native vectors are up to date: ${cases.length} changes.`);
} else {
  for (const { path, expected } of files) writeFileSync(path, expected);
  console.log(`Wrote ${cases.length} changes to the native vectors.`);
}
