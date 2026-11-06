// Writes the cases the native core is tested against, computed by the shared rules: change
// validity for sessions and sets at each bound, the exact JSON each change is sent as, field
// merge and time clamping, the instant and id formats. With --check, fails if the committed file
// is not what the rules give today, so a rule changed here cannot drift from the Swift port.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { EXERCISE_ID } from "../packages/shared/src/exercises/library";
import { clampAt, isNewer } from "../packages/shared/src/sync/merge";
import { ChangeSchema, type Change } from "../packages/shared/src/sync/schema";
import { isValidChange } from "../packages/shared/src/sync/valid";
import { SESSION_NAME_MAX } from "../packages/shared/src/training/stored-program";
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
} from "../packages/shared/src/training/workout";

const target = fileURLToPath(
  new URL("../apps/apple/BelayCore/Tests/BelayCoreTests/Vectors/contract.json", import.meta.url),
);

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
  },
  changes: cases,
  ...merge,
  ids,
  instants,
};
const expected = `${JSON.stringify(vectors, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // Missing file: reported as out of date below.
  }
  if (current !== expected) {
    console.error("The native vectors are out of date. Run `pnpm vectors` and commit the result.");
    process.exit(1);
  }
  console.log(`The native vectors are up to date: ${cases.length} changes.`);
} else {
  writeFileSync(target, expected);
  console.log(`Wrote ${cases.length} changes to the native vectors.`);
}
