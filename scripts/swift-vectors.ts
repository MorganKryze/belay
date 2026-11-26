// Writes the cases the native core is tested against, computed by the shared rules: change
// validity for sessions and sets at each bound, the exact JSON each change is sent as, field
// merge and time clamping, the instant and id formats; then the session rules (order of sets,
// rest, prefill, closing a forgotten session) and the schedule rules (plan of the day, rotation,
// fixed days, in several time zones), the session's tools (loading a bar, warm-ups, editing the
// day's plan, pausing), which workouts Health should hold, the body rules (weigh-in averages and
// weeks, the loss range, measures, intake, creatine, the energy and protein tools), and the
// starting program, the science catalogue and the body figure the native core ships. With
// --check, fails if a committed file is not what the rules give today, so a rule changed here
// cannot drift from the Swift port.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { ANNOTATION_LABEL_MAX, isAnnotationLabel } from "../packages/shared/src/body/annotations";
import {
  identifierHref,
  identifierLabel,
  shortAuthors,
} from "../packages/shared/src/science/render";
import { sourceById } from "../packages/shared/src/science/sources";
import { SCIENCE_IDS, TOOL_SCIENCE } from "../packages/shared/src/science/tools";
import { addDays, isoWeekStart, toISODate } from "../packages/shared/src/body/dates";
import {
  INTAKE_BOUNDS,
  type IntakeLog,
  isKcal,
  isProteinG,
  weeklyIntake,
} from "../packages/shared/src/body/intake";
import {
  isMeasureCm,
  latestMeasures,
  type Measure,
  MEASURE_BOUNDS,
  MEASURE_FIELDS,
  weeklyWaist,
} from "../packages/shared/src/body/measures";
import {
  ageIn,
  birthYearRange,
  isBirthYear,
  isProfileHeight,
  type Profile,
} from "../packages/shared/src/body/profile";
import {
  CREATINE_DAYS,
  creatineWindows,
  isCreatineName,
  isSupplementName,
  SUPPLEMENT_NAME_MAX,
  SUPPLEMENT_SUGGESTIONS,
} from "../packages/shared/src/body/supplements";
import {
  DEFAULT_TARGET,
  inTargetRange,
  isTargetRange,
  TARGET_BOUNDS,
} from "../packages/shared/src/body/target";
import {
  AGE_RANGE_YEARS,
  HEIGHT_RANGE_CM,
  WEIGHT_RANGE_KG,
} from "../packages/shared/src/tools/bounds";
import { EQUIPMENT, MUSCLES } from "../packages/shared/src/exercises/muscles";
import {
  DELTOID_CUT,
  GAP,
  shapesOf,
  thumbnailOf,
  VIEW_BOX,
} from "../apps/web/src/exercises/body-map";
import { absoluteCubics } from "./svg-path";
import {
  INCREMENT_LB,
  incrementIn,
  KG_PER_LB,
  kgFromLoad,
  kgFromWeighing,
  kgToLb,
  lbToKg,
  loadFromKg,
  loadKgFrom,
  rangeIn,
  readBack,
  stepIn,
  weighingFromKg,
  type WeightUnit,
} from "../packages/shared/src/tools/units";
import { toolDefaults } from "../packages/shared/src/body/tool-defaults";
import {
  isWeighingKg,
  latestMovingAverage,
  MIN_WEIGH_IN_DATE,
  MIN_WEIGHINGS,
  movingAverage7,
  movingAverageSeries,
  type Weighing,
  WEIGHING_RANGE_KG,
  weeklySummaries,
} from "../packages/shared/src/body/weighings";
import {
  dailyEnergy,
  type MifflinInput,
  mifflinStJeor,
  PAL_LEVELS,
} from "../packages/shared/src/tools/energy";
import {
  CUT_FLOOR_G_PER_KG,
  type ProteinGoal,
  proteinRange,
} from "../packages/shared/src/tools/protein";
import { roundTo } from "../packages/shared/src/tools/round";
import { EXERCISES } from "../packages/shared/src/exercises/catalog";
import { EXERCISE_ID, type Exercise, toRow } from "../packages/shared/src/exercises/library";
import { type Filters, filterExercises } from "../packages/shared/src/exercises/search";
import {
  DAY,
  EARLIEST,
  finishedSpan,
  IMPORT_STAMP_MS,
  ownerOf,
  planHealth,
  sampleTime,
  sessionKey,
  versionOf,
  weighingKey,
} from "../apps/web/src/native/health-plan";
import {
  HISTORY_SINCE,
  IMPORT_KEY,
  SETTINGS_KEY,
  type HealthImport,
  type HealthSample,
  type Written,
} from "../apps/web/src/native/health";
import { earliestPerDay, importWeighings } from "../apps/web/src/native/health-import";
import type { WeightRow } from "../packages/shared/src/sync/schema";
import { API_VERSION, MAX_CHANGES } from "../packages/shared/src/sync/limits";
import { clampAt, isNewer, mergeFields } from "../packages/shared/src/sync/merge";
import { ChangeSchema, type Change, SyncResponseSchema } from "../packages/shared/src/sync/schema";
import { isRecordable, isValidChange } from "../packages/shared/src/sync/valid";
import { stepsToWrite } from "../packages/shared/src/training/steps-import";
import {
  type Activity,
  ACTIVITY_KINDS,
  ACTIVITY_MINUTES,
  activitySummary,
  CARDIO_TYPES,
  CLIMB_COLORS,
  CLIMB_GRADES,
  CLIMB_RUNS,
  CLIMB_STYLES,
  climbedThisWeek,
  isActivityFields,
  isActivityMinutes,
  isClimbRuns,
  isSteps,
  STEPS,
  type StepsLog,
  stepsOf,
} from "../packages/shared/src/training/activities";
import {
  iwfColor,
  LB_PLATES,
  loadBar,
  MAX_TARGET_KG,
  nearestLoading,
  PLATE_PRESETS,
  STANDARD_BARS_KG,
  STANDARD_PLATES_KG,
} from "../packages/shared/src/tools/plates";
import {
  brzycki,
  epley,
  MAX_REPS,
  oneRepMax,
  RELIABLE_MAX_REPS,
} from "../packages/shared/src/tools/one-rep-max";
import {
  kgPerWeek,
  projectLoss,
  RATE_MAX_PCT,
  RATE_MIN_PCT,
  RATE_PRESETS,
  RATE_STEP_PCT,
  rateWarning,
  slowWeeks,
} from "../packages/shared/src/tools/projection";
import {
  bmi,
  bmiBand,
  bmiSuggestsProfessional,
  BMI_THRESHOLDS,
} from "../packages/shared/src/tools/bmi";
import {
  ageGroup,
  type BodyFatReference,
  bodyFatBand,
  gallagherThresholds,
  NAVY_RANGE_PCT,
  type NavyInput,
  navyBodyFat,
} from "../packages/shared/src/tools/body-fat";
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
  finishedOn as finishedOnDay,
  type History,
  lastFinished,
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
  workSetsOf,
} from "../packages/shared/src/training/rules";
import { chooseActive, programOrder } from "../packages/shared/src/training/program-edits";
import {
  type DayPlan,
  dayPlan,
  daysOf,
  fixedWeek,
  plannedNext,
  sessionDays,
  type Week,
  weekdayOf,
} from "../packages/shared/src/training/schedule";
import { STARTING_DAYS, weekOrder } from "../packages/shared/src/training/schedule-week";
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
const PROGRAM = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f03";
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
const activeProgram = (over: Fields = {}) => ({
  kind: "activeProgram",
  programId: PROGRAM,
  at: AT,
  ...over,
});
const timedSet = { exerciseId: TIMED, reps: null, seconds: 45, rir: null };
const warmupSet = { position: 0, warmup: true, rir: null, weightKg: 60 };

const step = SET_KG.step;
const text = (n: number) => "x".repeat(n);
// Two UTF-16 units each: the bounds count units, as the database does.
const emoji = (n: number) => "\u{1F4AA}".repeat(n);

// The body entries are dated by the person's day, read in the zone the vectors are made in: an
// entry is never dated after it.
const TODAY = toISODate(new Date(T0));
const TOMORROW = addDays(TODAY, 1);
const BEFORE_FLOOR = addDays(MIN_WEIGH_IN_DATE, -1);
const SUPPLEMENT = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f06";
const ANNOTATION = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f07";
const weight = (over: Fields = {}) => ({
  kind: "weight",
  date: TODAY,
  weightKg: 80.2,
  at: AT,
  ...over,
});
const measure = (field: string, value: unknown, over: Fields = {}) => ({
  kind: "measure",
  date: TODAY,
  field,
  value,
  at: AT,
  ...over,
});
const intake = (field: string, value: unknown, over: Fields = {}) => ({
  kind: "intake",
  date: TODAY,
  field,
  value,
  at: AT,
  ...over,
});
const supplementLog = (over: Fields = {}) => ({
  kind: "supplementLog",
  supplementId: SUPPLEMENT,
  date: TODAY,
  taken: true,
  at: AT,
  ...over,
});
const annotation = (over: Fields = {}) => ({
  kind: "annotation",
  id: ANNOTATION,
  field: "fields",
  date: TODAY,
  type: "deload",
  label: "Semaine légère",
  at: AT,
  ...over,
});
const annotationRemoved = (value: unknown) => ({
  kind: "annotation",
  id: ANNOTATION,
  field: "removed",
  value,
  at: AT,
});
// The kinds the phone writes from its settings and tools: a fact of the profile, the loss range,
// a supplement of the list, an activity, a day's steps.
const ACTIVITY = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f08";
const profile = (field: string, value: unknown, over: Fields = {}) => ({
  kind: "profile",
  field,
  value,
  at: AT,
  ...over,
});
const target = (minPct: unknown, maxPct: unknown, over: Fields = {}) => ({
  kind: "target",
  minPct,
  maxPct,
  at: AT,
  ...over,
});
const supplement = (field: string, value: unknown, over: Fields = {}) => ({
  kind: "supplement",
  id: SUPPLEMENT,
  field,
  value,
  at: AT,
  ...over,
});
const climbing = (over: Fields = {}) => ({
  kind: "activity",
  id: ACTIVITY,
  field: "fields",
  date: TODAY,
  type: "climbing",
  durationMin: 90,
  cardioType: null,
  climbStyle: "boulder",
  climbRuns: 12,
  climbGrade: "6a",
  climbColor: null,
  at: AT,
  ...over,
});
const running = (over: Fields = {}) =>
  climbing({
    type: "cardio",
    durationMin: 45,
    cardioType: "run",
    climbStyle: null,
    climbRuns: null,
    climbGrade: null,
    ...over,
  });
const activityRemoved = (value: unknown) => ({
  kind: "activity",
  id: ACTIVITY,
  field: "removed",
  value,
  at: AT,
});
const steps = (value: unknown, over: Fields = {}) => ({
  kind: "steps",
  date: TODAY,
  value,
  at: AT,
  ...over,
});
// The range on its grid, written as hundredths so each bound is the literal a person picks:
// every pair from a step under the floor to a step past the ceiling, one and two steps apart.
const pct = (hundredths: number) => hundredths / 100;
const rangeCases = Object.fromEntries(
  Array.from({ length: 17 }, (_, i) => 20 + 5 * i).flatMap((lo) =>
    [5, 10, 15].map((gap) => [
      `target: ${pct(lo)} to ${pct(lo + gap)}`,
      target(pct(lo), pct(lo + gap)),
    ]),
  ),
);
const YEAR = Number(TODAY.slice(0, 4));
const KG = WEIGHING_RANGE_KG;
// Every measure is kept to the tenth, whatever its field's bounds.
const measureCases = Object.fromEntries(
  MEASURE_FIELDS.flatMap((field) => {
    const { min, max } = MEASURE_BOUNDS[field];
    return [
      [`measure: ${field} at its floor`, measure(field, min)],
      [`measure: ${field} a tenth under its floor`, measure(field, min - 0.1)],
      [`measure: ${field} at its ceiling`, measure(field, max)],
      [`measure: ${field} a tenth past its ceiling`, measure(field, max + 0.1)],
      [`measure: ${field} on the tenth`, measure(field, min + 4.3)],
      [`measure: ${field} between two tenths`, measure(field, min + 4.35)],
      [`measure: ${field} deleted`, measure(field, null)],
    ];
  }),
);

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
  "set: done at the clock's slack after its change": createSet({
    doneAt: iso(T0 + CLOCK_SLACK_MS),
  }),
  "set: done past the clock's slack after its change": createSet({
    doneAt: iso(T0 + CLOCK_SLACK_MS + 1),
  }),
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
  // The active program: the id rule, and its time read like any change's, whatever the clock.
  "activeProgram: as the phone writes it": activeProgram(),
  "activeProgram: the starting program": activeProgram({
    programId: "00000000-0000-7000-8000-000000000010",
  }),
  "activeProgram: program id in upper case": activeProgram({ programId: PROGRAM.toUpperCase() }),
  "activeProgram: program id not a UUID": activeProgram({ programId: "push-pull" }),
  "activeProgram: nil program id": activeProgram({
    programId: "00000000-0000-0000-0000-000000000000",
  }),
  "activeProgram: no program id": activeProgram({ programId: undefined }),
  "activeProgram: program id null": activeProgram({ programId: null }),
  "activeProgram: at the floor": activeProgram({ at: MIN_TIME }),
  "activeProgram: one millisecond before the floor": activeProgram({ at: iso(MIN_MS - 1) }),
  "activeProgram: at the clock's slack": activeProgram({ at: iso(T0 + CLOCK_SLACK_MS) }),
  "activeProgram: one millisecond past the slack": activeProgram({
    at: iso(T0 + CLOCK_SLACK_MS + 1),
  }),
  "activeProgram: at without milliseconds": activeProgram({ at: "2026-11-06T09:30:00Z" }),
  "activeProgram: at not a time": activeProgram({ at: "yesterday" }),
  // The body entries: a weigh-in on the 0.1 kg grid from 20 to 400 kg, null deleting the day's.
  "weight: as the phone writes it": weight(),
  "weight: deleted": weight({ weightKg: null }),
  "weight: no weight": weight({ weightKg: undefined }),
  "weight: at its floor": weight({ weightKg: KG.min }),
  "weight: a step under its floor": weight({ weightKg: KG.min - KG.step }),
  "weight: at its ceiling": weight({ weightKg: KG.max }),
  "weight: a step past its ceiling": weight({ weightKg: KG.max + KG.step }),
  "weight: on the grid with binary noise": weight({ weightKg: 79.8 }),
  "weight: half a step off the grid": weight({ weightKg: 80.25 }),
  "weight: a twentieth off the grid": weight({ weightKg: 80.05 }),
  "weight: whole": weight({ weightKg: 80 }),
  "weight: as text": weight({ weightKg: "80.2" }),
  "weight: dated today": weight({ date: TODAY }),
  "weight: dated tomorrow": weight({ date: TOMORROW }),
  "weight: dated at the floor": weight({ date: MIN_WEIGH_IN_DATE }),
  "weight: dated the day before the floor": weight({ date: BEFORE_FLOOR }),
  "weight: dated on a leap day": weight({ date: "2024-02-29" }),
  "weight: dated on a day past the month's end": weight({ date: "2026-02-29" }),
  "weight: dated without padding": weight({ date: "2026-11-6" }),
  "weight: dated with a time": weight({ date: `${TODAY}T08:00:00` }),
  "weight: at without milliseconds": weight({ at: "2026-11-06T09:30:00Z" }),
  ...measureCases,
  "measure: unknown field": measure("thigh", 55),
  "measure: as text": measure("waist", "84.5"),
  "measure: dated tomorrow": measure("waist", 84.5, { date: TOMORROW }),
  "measure: dated at the floor": measure("waist", 84.5, { date: MIN_WEIGH_IN_DATE }),
  "measure: dated the day before the floor": measure("waist", 84.5, { date: BEFORE_FLOOR }),
  "intake: kcal as the phone writes it": intake("kcal", 1850),
  "intake: no kcal": intake("kcal", INTAKE_BOUNDS.kcal.min),
  "intake: kcal at its bound": intake("kcal", INTAKE_BOUNDS.kcal.max),
  "intake: kcal one past": intake("kcal", INTAKE_BOUNDS.kcal.max + 1),
  "intake: kcal below zero": intake("kcal", -1),
  "intake: kcal off the stepper": intake("kcal", 2130),
  "intake: kcal not whole": intake("kcal", 1850.5),
  "intake: kcal deleted": intake("kcal", null),
  "intake: protein as the phone writes it": intake("protein", 128),
  "intake: no protein": intake("protein", INTAKE_BOUNDS.protein.min),
  "intake: protein at its bound": intake("protein", INTAKE_BOUNDS.protein.max),
  "intake: protein one past": intake("protein", INTAKE_BOUNDS.protein.max + 1),
  "intake: protein not whole": intake("protein", 127.5),
  "intake: protein deleted": intake("protein", null),
  "intake: unknown field": intake("fat", 60),
  "intake: dated tomorrow": intake("kcal", 1850, { date: TOMORROW }),
  "intake: dated the day before the floor": intake("kcal", 1850, { date: BEFORE_FLOOR }),
  "supplementLog: taken": supplementLog(),
  "supplementLog: untaken": supplementLog({ taken: false }),
  "supplementLog: taken as text": supplementLog({ taken: "yes" }),
  "supplementLog: supplement id in upper case": supplementLog({
    supplementId: SUPPLEMENT.toUpperCase(),
  }),
  "supplementLog: dated tomorrow": supplementLog({ date: TOMORROW }),
  "supplementLog: dated at the floor": supplementLog({ date: MIN_WEIGH_IN_DATE }),
  "supplementLog: dated the day before the floor": supplementLog({ date: BEFORE_FLOOR }),
  "annotation: as the phone writes it": annotation(),
  "annotation: diet break": annotation({ type: "diet_break" }),
  "annotation: note without a label": annotation({ type: "note", label: null }),
  "annotation: no label": annotation({ label: undefined }),
  "annotation: unknown type": annotation({ type: "travel" }),
  "annotation: label at its bound": annotation({ label: text(ANNOTATION_LABEL_MAX) }),
  "annotation: label one past": annotation({ label: text(ANNOTATION_LABEL_MAX + 1) }),
  "annotation: label in emoji at its bound": annotation({
    label: emoji(ANNOTATION_LABEL_MAX / 2),
  }),
  "annotation: label in emoji one past": annotation({
    label: emoji(ANNOTATION_LABEL_MAX / 2 + 1),
  }),
  "annotation: label empty": annotation({ label: "" }),
  "annotation: label on two lines": annotation({ label: "Semaine\nlégère" }),
  "annotation: label with a carriage return": annotation({ label: "Semaine\rlégère" }),
  "annotation: id in upper case": annotation({ id: ANNOTATION.toUpperCase() }),
  "annotation: dated tomorrow": annotation({ date: TOMORROW }),
  "annotation: dated the day before the floor": annotation({ date: BEFORE_FLOOR }),
  "annotation removed: true": annotationRemoved(true),
  "annotation removed: false": annotationRemoved(false),
  "annotation removed: not a boolean": annotationRemoved("yes"),
  "annotation: unknown field": { kind: "annotation", id: ANNOTATION, field: "moved", at: AT },
  ...rangeCases,
  "target: the defaults": target(DEFAULT_TARGET.minPct, DEFAULT_TARGET.maxPct),
  "target: off the grid": target(0.27, 0.5),
  "target: the wrong way round": target(0.75, 0.5),
  "target: as text": target("0.5", 1),
  "target: no maximum": target(0.5, undefined),
  "profile: formula female": profile("formula", "female"),
  "profile: formula male": profile("formula", "male"),
  "profile: formula cleared": profile("formula", null),
  "profile: formula unknown": profile("formula", "other"),
  "profile: birth year at the oldest": profile("birthYear", YEAR - AGE_RANGE_YEARS.max),
  "profile: birth year one older": profile("birthYear", YEAR - AGE_RANGE_YEARS.max - 1),
  "profile: birth year at the youngest": profile("birthYear", YEAR - AGE_RANGE_YEARS.min),
  "profile: birth year one younger": profile("birthYear", YEAR - AGE_RANGE_YEARS.min + 1),
  "profile: birth year not whole": profile("birthYear", 1990.5),
  "profile: birth year cleared": profile("birthYear", null),
  "profile: height 119": profile("height", HEIGHT_RANGE_CM.min - 1),
  "profile: height 120": profile("height", HEIGHT_RANGE_CM.min),
  "profile: height 230": profile("height", HEIGHT_RANGE_CM.max),
  "profile: height 231": profile("height", HEIGHT_RANGE_CM.max + 1),
  "profile: height 170.5": profile("height", 170.5),
  "profile: height cleared": profile("height", null),
  "profile: height as text": profile("height", "170"),
  "profile: unknown field": profile("weight", 80),
  "supplement: named": supplement("name", "Créatine"),
  "supplement: name of 0 characters": supplement("name", ""),
  "supplement: name of 1 character": supplement("name", "D"),
  "supplement: name of 40 characters": supplement("name", text(SUPPLEMENT_NAME_MAX)),
  "supplement: name of 41 characters": supplement("name", text(SUPPLEMENT_NAME_MAX + 1)),
  "supplement: name of 40 characters in emoji": supplement("name", emoji(SUPPLEMENT_NAME_MAX / 2)),
  "supplement: name of 41 characters in emoji": supplement(
    "name",
    emoji(SUPPLEMENT_NAME_MAX / 2 + 1),
  ),
  "supplement: name blank": supplement("name", "   "),
  "supplement: name not trimmed": supplement("name", " Créatine "),
  "supplement: name ending in a no-break space": supplement("name", "Créatine\u00a0"),
  "supplement: name with a line break": supplement("name", "Vitamine\nD"),
  "supplement: name with a carriage return": supplement("name", "Vitamine\rD"),
  "supplement: name with an inner space": supplement("name", "Vitamine D"),
  "supplement: id in upper case": supplement("name", "Zinc", { id: SUPPLEMENT.toUpperCase() }),
  "supplement removed: true": supplement("removed", true),
  "supplement removed: false": supplement("removed", false),
  "supplement removed: not a boolean": supplement("removed", "yes"),
  "supplement: unknown field": supplement("kind", "creatine"),
  "activity: a climb as the phone writes it": climbing(),
  "activity: a climb with nothing but its time": climbing({
    climbStyle: null,
    climbRuns: null,
    climbGrade: null,
  }),
  "activity: a route by its colour": climbing({
    climbStyle: "route",
    climbGrade: null,
    climbColor: "purple",
  }),
  "activity: grade and colour together": climbing({ climbColor: "blue" }),
  "activity: grade off the list": climbing({ climbGrade: "9a" }),
  "activity: grade at the top": climbing({ climbGrade: CLIMB_GRADES.at(-1) }),
  "activity: grade in upper case": climbing({ climbGrade: "6A" }),
  "activity: unknown colour": climbing({ climbGrade: null, climbColor: "orange" }),
  "activity: unknown style": climbing({ climbStyle: "ice" }),
  "activity: runs -1": climbing({ climbRuns: CLIMB_RUNS.min - 1 }),
  "activity: runs 0": climbing({ climbRuns: CLIMB_RUNS.min }),
  "activity: runs 200": climbing({ climbRuns: CLIMB_RUNS.max }),
  "activity: runs 201": climbing({ climbRuns: CLIMB_RUNS.max + 1 }),
  "activity: minutes 0": climbing({ durationMin: 0 }),
  "activity: minutes 5": climbing({ durationMin: ACTIVITY_MINUTES.min }),
  "activity: minutes 7": climbing({ durationMin: 7 }),
  "activity: minutes 480": climbing({ durationMin: ACTIVITY_MINUTES.max }),
  "activity: minutes 485": climbing({ durationMin: ACTIVITY_MINUTES.max + ACTIVITY_MINUTES.step }),
  "activity: minutes not whole": climbing({ durationMin: 7.5 }),
  "activity: a run": running(),
  "activity: cardio of every type": running({ cardioType: "other" }),
  "activity: cardio without its type": running({ cardioType: null }),
  "activity: cardio of an unknown type": running({ cardioType: "yoga" }),
  "activity: cardio with a climb's fields": running({ climbRuns: 3 }),
  "activity: a climb with a cardio type": climbing({ cardioType: "run" }),
  "activity: unknown type": climbing({ type: "yoga" }),
  "activity: id in upper case": climbing({ id: ACTIVITY.toUpperCase() }),
  "activity: dated tomorrow": climbing({ date: TOMORROW }),
  "activity: dated at the floor": climbing({ date: MIN_WEIGH_IN_DATE }),
  "activity: dated the day before the floor": climbing({ date: BEFORE_FLOOR }),
  "activity removed: true": activityRemoved(true),
  "activity removed: false": activityRemoved(false),
  "activity removed: not a boolean": activityRemoved("yes"),
  "activity: unknown field": { kind: "activity", id: ACTIVITY, field: "moved", at: AT },
  "steps: as the phone writes them": steps(8437),
  "steps: -1": steps(STEPS.min - 1),
  "steps: 0": steps(STEPS.min),
  "steps: 100 000": steps(STEPS.max),
  "steps: 100 001": steps(STEPS.max + 1),
  "steps: 1.5": steps(1.5),
  "steps: deleted": steps(null),
  "steps: as text": steps("8437"),
  "steps: dated tomorrow": steps(8437, { date: TOMORROW }),
  "steps: dated at the floor": steps(8437, { date: MIN_WEIGH_IN_DATE }),
  "steps: dated the day before the floor": steps(8437, { date: BEFORE_FLOOR }),
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

// The body merge, one key per stored time as the server keys them: two writes for one key, a
// deletion against a later value, ties, and a clock ahead.
type Body = Change & { at: string };
const minute = (n: number) => iso(T0 + n * 60_000);
const mergeCase =
  (kind: string, key: (c: Body) => string) =>
  ([name, stored, list]: [string, Record<string, string | null>, Body[]]) => {
    const kept = mergeFields(new Map(Object.entries(stored)), list, key, new Date(T0));
    return {
      name: `${kind}: ${name}`,
      stored,
      now: AT,
      changes: list.map((c) => JSON.stringify(c)),
      kept: kept.map((c) => JSON.stringify(c)),
    };
  };
const bodyMerge = (
  kind: string,
  key: (c: Body) => string,
  write: (at: string) => Body,
  remove: (at: string) => Body,
  other: Body,
  more: [string, Record<string, string | null>, Body[]][] = [],
) => {
  const k = key(write(AT));
  const cases: [string, Record<string, string | null>, Body[]][] = [
    ["two writes for one key", {}, [write(minute(-1)), write(AT)]],
    ["two writes at one time, the later sent wins", {}, [write(AT), remove(AT)]],
    ["a deletion against a later value", { [k]: minute(1) }, [remove(AT)]],
    ["a deletion after the stored value", { [k]: minute(-1) }, [remove(AT)]],
    ["a write at the stored time", { [k]: AT }, [write(AT)]],
    ["a key never written", { [k]: null }, [write(AT)]],
    ["a time ahead of the clock", {}, [write(minute(60))]],
    ["a past write and an older one", { [k]: minute(-5) }, [write(minute(-2)), remove(minute(-3))]],
    ["another key at the same time", { [k]: minute(1) }, [write(AT), other]],
  ];
  return [...cases, ...more].map(mergeCase(kind, key));
};
const asBody = <T>(c: T) => c as unknown as Body;
const mergeBody = [
  ...bodyMerge(
    "weight",
    (c) => (c as { date: string }).date,
    (at) => asBody(weight({ at })),
    (at) => asBody(weight({ weightKg: null, at })),
    asBody(weight({ date: addDays(TODAY, -1) })),
  ),
  ...bodyMerge(
    "measure",
    (c) => `${(c as { date: string }).date}|${(c as { field: string }).field}`,
    (at) => asBody(measure("waist", 84.5, { at })),
    (at) => asBody(measure("waist", null, { at })),
    asBody(measure("hip", 98)),
  ),
  ...bodyMerge(
    "intake",
    (c) => `${(c as { date: string }).date}|${(c as { field: string }).field}`,
    (at) => asBody(intake("protein", 128, { at })),
    (at) => asBody(intake("protein", null, { at })),
    asBody(intake("kcal", 1850)),
  ),
  ...bodyMerge(
    "supplementLog",
    (c) => `${(c as { supplementId: string }).supplementId}|${(c as { date: string }).date}`,
    (at) => asBody(supplementLog({ at })),
    (at) => asBody(supplementLog({ taken: false, at })),
    asBody(supplementLog({ supplementId: ANNOTATION })),
  ),
  ...bodyMerge(
    "annotation",
    (c) => `${(c as { id: string }).id}|${(c as { field: string }).field}`,
    (at) => asBody({ ...annotationRemoved(false), at }),
    (at) => asBody({ ...annotationRemoved(true), at }),
    asBody(annotation()),
  ),
  // The kinds the phone now writes, keyed as the server keys them: a profile fact by its field,
  // the range as one, a supplement's and an activity's field by id, a day's steps by day.
  ...bodyMerge(
    "profile",
    (c) => (c as { field: string }).field,
    (at) => asBody(profile("height", 172, { at })),
    (at) => asBody(profile("height", null, { at })),
    asBody(profile("formula", "female")),
  ),
  ...bodyMerge(
    "target",
    () => "target",
    (at) => asBody(target(0.5, 0.75, { at })),
    (at) => asBody(target(0.25, 1, { at })),
    asBody(target(0.5, 1)),
  ),
  ...bodyMerge(
    "supplement",
    (c) => `${(c as { id: string }).id}|${(c as { field: string }).field}`,
    (at) => asBody(supplement("name", "Créatine", { at })),
    (at) => asBody(supplement("name", "Créatine monohydrate", { at })),
    asBody(supplement("removed", true)),
    [
      [
        "a removal against a later rename",
        { [`${SUPPLEMENT}|name`]: minute(1), [`${SUPPLEMENT}|removed`]: null },
        [asBody(supplement("removed", true))],
      ],
      [
        "a removal and a rename in one batch",
        {},
        [
          asBody(supplement("removed", true)),
          asBody(supplement("name", "Zinc", { at: minute(1) })),
        ],
      ],
      [
        "a removal against a later put back",
        { [`${SUPPLEMENT}|removed`]: minute(1) },
        [asBody(supplement("removed", true))],
      ],
    ],
  ),
  ...bodyMerge(
    "activity",
    (c) => `${(c as { id: string }).id}|${(c as { field: string }).field}`,
    (at) => asBody(climbing({ at })),
    (at) => asBody(climbing({ durationMin: 120, climbGrade: "6b", at })),
    asBody(activityRemoved(true)),
    [
      [
        "a removal against a later edit",
        { [`${ACTIVITY}|fields`]: minute(1) },
        [asBody(activityRemoved(true))],
      ],
    ],
  ),
  ...bodyMerge(
    "steps",
    (c) => (c as { date: string }).date,
    (at) => asBody(steps(8437, { at })),
    (at) => asBody(steps(null, { at })),
    asBody(steps(12_000, { date: addDays(TODAY, -1) })),
    [
      [
        "a day's steps from two devices, the other later",
        { [TODAY]: minute(1) },
        [asBody(steps(9100, { at: minute(-1) })), asBody(steps(8437))],
      ],
      [
        "a day's steps from two devices, this one later",
        { [TODAY]: minute(-1) },
        [asBody(steps(8437))],
      ],
    ],
  ),
];
// An answer carrying every body row, each written and unwritten, checked against the server's
// contract so the phone reads what the server really sends.
const bodyAnswer = SyncResponseSchema.parse({
  cursor: "45",
  weights: [
    { date: TODAY, weightKg: 80.2, at: AT },
    { date: addDays(TODAY, -1), weightKg: null, at: AT },
  ],
  measures: [
    {
      date: TODAY,
      waistCm: 84.5,
      waistAt: AT,
      neckCm: null,
      neckAt: null,
      hipCm: null,
      hipAt: AT,
    },
  ],
  intake: [{ date: TODAY, kcal: 1850, kcalAt: AT, proteinG: null, proteinAt: null }],
  supplements: [
    {
      id: SUPPLEMENT,
      name: "Créatine",
      nameAt: AT,
      kind: "creatine",
      removed: false,
      removedAt: null,
    },
    { id: ANNOTATION, name: "Oméga 3", nameAt: AT, kind: "other", removed: true, removedAt: AT },
  ],
  supplementLogs: [{ supplementId: SUPPLEMENT, date: TODAY, taken: true, at: AT }],
  annotations: [
    {
      id: ANNOTATION,
      date: TODAY,
      type: "diet_break",
      label: null,
      fieldsAt: AT,
      removed: false,
      removedAt: null,
    },
  ],
  steps: [
    { date: TODAY, steps: 8437, stepsAt: AT },
    { date: addDays(TODAY, -1), steps: null, stepsAt: AT },
  ],
  activities: [
    {
      id: ACTIVITY,
      date: TODAY,
      type: "climbing",
      durationMin: 90,
      cardioType: null,
      climbStyle: "route",
      climbRuns: 8,
      climbGrade: null,
      climbColor: "purple",
      fieldsAt: AT,
      removed: false,
      removedAt: null,
    },
    {
      id: SUPPLEMENT,
      date: addDays(TODAY, -1),
      type: "cardio",
      durationMin: 45,
      cardioType: "run",
      climbStyle: null,
      climbRuns: null,
      climbGrade: null,
      climbColor: null,
      fieldsAt: AT,
      removed: true,
      removedAt: AT,
    },
  ],
  workouts: [],
  sets: [],
  target: { minPct: 0.5, maxPct: 1, at: null },
  profile: {
    formula: "male",
    formulaAt: AT,
    birthYear: 1990,
    birthYearAt: AT,
    heightCm: null,
    heightAt: null,
  },
  rejected: [],
  hasMore: false,
});

// The phone's today against the instant, in the zone the vectors are made in, either side of
// midnight.
const days = [
  T0,
  Date.UTC(2026, 10, 6, 22, 59, 59, 999),
  Date.UTC(2026, 10, 6, 23, 0, 0, 0),
  // Either side of the spring change: the zone's offset moves from one hour to two.
  Date.UTC(2026, 2, 28, 22, 59, 59, 999),
  Date.UTC(2026, 2, 28, 23, 0, 0, 0),
  Date.UTC(2026, 2, 29, 21, 59, 59, 999),
  Date.UTC(2026, 2, 29, 22, 0, 0, 0),
].map((ms) => {
  const today = toISODate(new Date(ms));
  return { now: iso(ms), today, tomorrow: addDays(today, 1) };
});

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

// The rules behind the new kinds' validity, each asked directly at its bounds, with the
// constants they read.
function predicateCases() {
  const fields = (over: Fields) => {
    const { type, durationMin, cardioType, climbStyle, climbRuns, climbGrade, climbColor } =
      climbing(over);
    return { type, durationMin, cardioType, climbStyle, climbRuns, climbGrade, climbColor };
  };
  const activityFields = [
    fields({}),
    fields({ climbStyle: null, climbRuns: null, climbGrade: null }),
    fields({ climbGrade: null, climbColor: "white" }),
    fields({ climbColor: "white" }),
    fields({ climbGrade: "5a" }),
    fields({ climbGrade: "8c+" }),
    fields({ climbGrade: "4c" }),
    fields({ climbRuns: 201 }),
    fields({ durationMin: 485 }),
    fields({ cardioType: "bike" }),
    fields({
      type: "cardio",
      cardioType: "swim",
      climbStyle: null,
      climbRuns: null,
      climbGrade: null,
    }),
    fields({ type: "cardio", cardioType: "swim", climbStyle: null, climbRuns: null }),
    fields({
      type: "cardio",
      cardioType: null,
      climbStyle: null,
      climbRuns: null,
      climbGrade: null,
    }),
    fields({ type: "yoga" }),
  ].map((f) => ({ fields: f, result: isActivityFields({ ...f, kind: f.type } as never) }));
  const todays = [TODAY, "2026-01-01", "2026-12-31", "2000-02-29"];
  return {
    bounds: {
      target: TARGET_BOUNDS,
      ageYears: AGE_RANGE_YEARS,
      heightCm: HEIGHT_RANGE_CM,
      supplementNameMax: SUPPLEMENT_NAME_MAX,
      activityMinutes: ACTIVITY_MINUTES,
      climbRuns: CLIMB_RUNS,
      steps: STEPS,
      activityKinds: ACTIVITY_KINDS,
      cardioTypes: CARDIO_TYPES,
      climbStyles: CLIMB_STYLES,
      climbColors: CLIMB_COLORS,
      climbGrades: CLIMB_GRADES,
    },
    isActivityMinutes: [-5, 0, 4, 5, 7, 10, 475, 480, 485].map((value) => ({
      value,
      result: isActivityMinutes(value),
    })),
    isClimbRuns: [-1, 0, 1, 200, 201].map((value) => ({ value, result: isClimbRuns(value) })),
    isSteps: [-1, 0, 1, 8437, 100_000, 100_001].map((value) => ({ value, result: isSteps(value) })),
    isProfileHeight: [0, 119, 120, 170, 230, 231].map((value) => ({
      value,
      result: isProfileHeight(value),
    })),
    isSupplementName: [
      "",
      " ",
      "D",
      " Créatine ",
      "Vitamine D",
      text(SUPPLEMENT_NAME_MAX),
      text(SUPPLEMENT_NAME_MAX + 1),
      ` ${text(SUPPLEMENT_NAME_MAX)} `,
      emoji(SUPPLEMENT_NAME_MAX / 2),
      emoji(SUPPLEMENT_NAME_MAX / 2 + 1),
      "Vitamine\nD",
      "Vitamine\rD",
      "Vitamine\tD",
      "\u00a0Zinc\u00a0",
    ].map((value) => ({ value, result: isSupplementName(value) })),
    birthYearRange: todays.map((today) => ({ today, ...birthYearRange(today) })),
    isBirthYear: todays.flatMap((today) => {
      const { min, max } = birthYearRange(today);
      return [min - 1, min, 1990, max, max + 1].map((year) => ({
        year,
        today,
        result: isBirthYear(year, today),
      }));
    }),
    isActivityFields: activityFields,
  };
}

const cases = Object.entries(changes).map(([name, change]) => {
  // Recordable: valid, and not dated after the phone's today, as the phone checks it.
  const valid = isRecordable(change as Change, TODAY);
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
    apiVersion: API_VERSION,
    weighInKg: WEIGHING_RANGE_KG,
    measureCm: MEASURE_BOUNDS,
    intake: INTAKE_BOUNDS,
    annotationLabelMax: ANNOTATION_LABEL_MAX,
    minDate: MIN_WEIGH_IN_DATE,
  },
  // The phone's clock and zone the verdicts were made with.
  clock: { now: AT, zone: Intl.DateTimeFormat().resolvedOptions().timeZone, today: TODAY },
  days,
  changes: cases,
  ...merge,
  mergeBody,
  bodyAnswer: JSON.stringify(bodyAnswer),
  ids,
  instants,
  predicates: predicateCases(),
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

// As the server sends an activity: every field, a climb or a run of an hour.
const asActivity = (a: Pick<Activity, "date" | "kind" | "removed">, i: number) => ({
  id: seedId(0x3000 + i),
  date: a.date,
  type: a.kind,
  durationMin: 60,
  cardioType: a.kind === "cardio" ? "run" : null,
  climbStyle: null,
  climbRuns: null,
  climbGrade: null,
  climbColor: null,
  fieldsAt: `${a.date}T18:00:00.000Z`,
  removed: a.removed,
  removedAt: a.removed ? `${a.date}T19:00:00.000Z` : null,
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

// What Accueil and Séances read of the schedule: the day's plan in full, the fixed week, the
// week's cards, the session done on a day and the program list. The starting programs, in
// rotation and on 1 to 7 fixed days, meet every kind of history on a midweek day, the Sunday Paris
// leaves summer time, the Monday after and the Monday after Los Angeles does, in every zone. A
// program is written once by name; a case sets its activation time.
const READ_DAYS = [fx.WED, fx.SUN, fx.NEXT_MON, "2026-11-02"];

// A fixed week as the rhythm sheet first offers it: the starting pattern, sessions in order.
const startingWeek = (rotation: readonly LetteredTemplate[], n: number) => {
  const days: (string | null)[] = Array<string | null>(7).fill(null);
  STARTING_DAYS[n - 1]!.forEach((day, at) => (days[day] = rotation[at]!.sessionId));
  return fx.fixed(days);
};
const withSchedule = (p: StoredPrograms, schedule: ReturnType<typeof fx.fixed>) => ({
  ...p,
  programs: p.programs.map((x) => (x.id === p.activeId ? { ...x, schedule } : x)),
});

// The last session day before `today`; in rotation, which has none, two days back.
function previousSessionDay(week: Week | null, today: string): string {
  if (!week) return addDays(today, -2);
  const k = [1, 2, 3, 4, 5, 6, 7].find((k) => week[weekdayOf(addDays(today, -k))])!;
  return addDays(today, -k);
}

type Planned = { session: LetteredTemplate; day: string };
const planned = (n: Planned) => ({ next: pick(n.session), nextDay: n.day });
// A plan as the native core reads it, flat: its kind, its session and workout, the next session
// and, off rotation, its day.
const planOf = (r: DayPlan) =>
  r.kind === "rotation"
    ? { kind: r.kind, next: pick(r.next) }
    : r.kind === "rest"
      ? { kind: r.kind, ...planned(r.next) }
      : r.kind === "due"
        ? { kind: r.kind, session: pick(r.session), ...planned(r.next) }
        : {
            kind: r.kind,
            session: pick(r.session),
            workout: r.workout.id,
            on: r.on,
            ...planned(r.next),
          };

function readVectors() {
  const programs: Record<string, StoredPrograms> = {};
  const named = (name: string, p: StoredPrograms) => {
    const had = programs[name];
    if (had && !isDeepStrictEqual(had, p)) throw new Error(`two programs named ${name}`);
    programs[name] = p;
    return name;
  };
  const seedRotation = rotationOf(SEED);
  const starters: [string, StoredPrograms][] = [
    ["the starting program", SEED],
    ["the starting program on fixed days", withSchedule(SEED, startingWeek(seedRotation, 3))],
    ...[1, 2, 3, 4, 5, 6, 7].map((n): [string, StoredPrograms] => {
      const p = fx.stored(n);
      return [`${n} session days`, withSchedule(p, startingWeek(rotationOf(p), n))];
    }),
  ];
  for (const [name, p] of starters) named(name, p);
  // The schedule suites' programs: Monday A, Wednesday B, Saturday C; Monday A alone; Monday A
  // and Sunday C; Monday and Thursday A, Wednesday B, Saturday C, D with no day.
  const mws = named("Monday, Wednesday, Saturday", fx.stored(3, fx.MWS));
  const mondays = named("Mondays", fx.stored(3, fx.MONDAYS));
  const sunMon = named(
    "Monday and Sunday",
    fx.stored(3, fx.fixed([fx.S(0), null, null, null, null, null, fx.S(2)])),
  );
  const twice = named(
    "A twice a week, D with no day",
    fx.stored(4, fx.fixed([fx.S(0), null, fx.S(1), fx.S(0), null, fx.S(2), null])),
  );
  const undated = named(
    "Monday A, three sessions with no day",
    fx.stored(4, fx.fixed([fx.S(0), null, null, null, null, null, null])),
  );

  const dayPlanCases = ZONES.flatMap((zone) =>
    inZone(zone, () => {
      const cases: [string, string, string | null, Done[], string][] = [];
      for (const [program, p] of starters)
        for (const today of READ_DAYS) {
          const rotation = rotationOf(p);
          const week = fixedWeek(p, rotation);
          const s = week?.[weekdayOf(today)] ?? week?.find((t) => t !== null) ?? rotation[0]!;
          const other = rotation.find((t) => t.sessionId !== s.sessionId) ?? s;
          const as = (t: LetteredTemplate, day: string, patch: Partial<Done> = {}) =>
            fx.did(t.code, t.sessionId, day, patch);
          const yesterday = addDays(today, -1);
          const byLetter = fx.did(s.code, null, yesterday);
          const instant = fx.local(today, 7);
          const twin = (id: number) =>
            as(s, today, {
              id: seedId(0xd000 + id),
              startedAt: instant,
              endedAt: fx.local(today, 8),
            });
          const histories: [string, Done[], string | null][] = [
            ["nothing done", [], null],
            ["its session done today", [as(s, today)], null],
            ["its session done the day before", [as(s, yesterday)], null],
            [
              "its session done on the previous session day",
              [as(s, previousSessionDay(week, today))],
              null,
            ],
            ["another session done today", [as(other, today)], null],
            [
              "its session started at 23:30 the night before",
              [
                as(s, yesterday, {
                  startedAt: fx.local(yesterday, 23, 30),
                  endedAt: fx.local(today, 0, 30),
                }),
              ],
              null,
            ],
            ["its letter only, before activation", [byLetter], fx.local(today, 0)],
            ["its letter only, after activation", [byLetter], fx.local(yesterday, 12)],
            ["two starts at one instant", [twin(1), twin(2)], null],
            ["two starts at one instant, the other order", [twin(2), twin(1)], null],
          ];
          for (const [name, workouts, activeAt] of histories)
            cases.push([`${program}, on ${today}: ${name}`, program, activeAt, workouts, today]);
        }
      // The schedule suites' cases, each day read where the person is.
      const lateSunday = fx.A(fx.SUN, {
        startedAt: fx.local(fx.SUN, 23, 30),
        endedAt: fx.local(fx.NEXT_MON, 0, 30),
      });
      const first = fx.B(fx.WED, { startedAt: fx.local(fx.WED, 8), endedAt: fx.local(fx.WED, 9) });
      const open = fx.B(fx.WED, { startedAt: fx.local(fx.WED, 20), endedAt: null });
      const removed = fx.B(fx.WED, { startedAt: fx.local(fx.WED, 21), removed: true });
      cases.push(
        ["due today", mws, null, [], fx.WED],
        ["done the day before", mws, null, [fx.A(fx.MON), fx.B(fx.TUE)], fx.WED],
        ["done today, the latest kept", mws, null, [fx.B(fx.WED), first, open, removed], fx.WED],
        ["only open and removed today", mws, null, [open, removed], fx.WED],
        ["done on the previous session day", mws, null, [fx.B(fx.MON)], fx.WED],
        ["another session in the window", mws, null, [fx.A(fx.TUE), fx.C(fx.TUE)], fx.WED],
        ["done after today", mws, null, [fx.B(fx.THU)], fx.WED],
        ["a rest day", mws, null, [], fx.TUE],
        ["Sunday", mws, null, [], fx.SUN],
        ["one day a week, done last Tuesday", mondays, null, [fx.A(fx.TUE)], fx.NEXT_MON],
        ["one day a week, done last Monday", mondays, null, [fx.A(fx.MON)], fx.NEXT_MON],
        ["one day a week, done today", mondays, null, [fx.A(fx.MON)], fx.MON],
        ["one day a week, a rest day", mondays, null, [], fx.TUE],
        [
          "started late on the Sunday summer time ends",
          sunMon,
          null,
          [fx.A(fx.MON), lateSunday],
          fx.NEXT_MON,
        ],
        ["recorded, before activation", mws, fx.local(fx.TUE, 19), [fx.B(fx.TUE)], fx.WED],
        ["a letter elsewhere", mws, null, [fx.did("C", null, fx.TUE)], fx.WED],
        ["A twice a week, on Thursday", twice, null, [fx.A(fx.MON)], fx.THU],
      );
      return cases.map(([name, program, activeAt, workouts, today]) => {
        const stored = { ...programs[program]!, activeAt };
        return {
          name: `${zone}: ${name}`,
          timeZone: zone,
          program,
          activeAt,
          workouts: workouts.map(asRow),
          today,
          result: planOf(dayPlan(workouts, stored, rotationOf(stored), today)),
        };
      });
    }),
  );

  // The fixed week of every program above, and of the schedule suites' edge cases: a session set
  // aside, removed, emptied, in the other program or unknown; no session day; another program
  // active or the active one removed; a reorder.
  const base7 = fx.stored(7);
  const base3 = fx.stored(3);
  named(
    "a set-aside, removed, emptied, other-program and unknown day",
    fx.stored(7, fx.fixed([fx.S(0), fx.S(2), fx.S(3), fx.S(4), fx.S(5), fx.S(1), fx.UNKNOWN]), {
      sessions: base7.sessions.map((s) =>
        s.id === fx.S(2)
          ? { ...s, programId: null }
          : s.id === fx.S(3)
            ? { ...s, removed: true }
            : s.id === fx.S(5)
              ? { ...s, programId: fx.P2 }
              : s,
      ),
      slots: base7.slots.filter((s) => s.sessionId !== fx.S(4)),
    }),
  );
  named(
    "no day holds a session",
    fx.stored(3, fx.fixed([fx.S(2), null, fx.UNKNOWN, null, null, null, null]), {
      sessions: base3.sessions.map((s) => (s.id === fx.S(2) ? { ...s, programId: null } : s)),
    }),
  );
  named("every day a rest day", fx.stored(3, fx.fixed(Array<null>(7).fill(null))));
  named("on fixed days, another program active", { ...fx.stored(3, fx.MWS), activeId: fx.P2 });
  const mwsStored = fx.stored(3, fx.MWS);
  named("on fixed days, the program removed", {
    ...mwsStored,
    programs: mwsStored.programs.map((x) => ({ ...x, removed: true })),
  });
  named("on fixed days, A and B reordered", {
    ...mwsStored,
    sessions: mwsStored.sessions.map((s) =>
      s.id === fx.S(0) ? { ...s, position: 1 } : s.id === fx.S(1) ? { ...s, position: 0 } : s,
    ),
  });
  const fixedWeekCases = Object.entries(programs).map(([program, p]) => {
    const rotation = rotationOf(p);
    const week = fixedWeek(p, rotation);
    return {
      name: program,
      program,
      result: week && {
        week: week.map(pick),
        sessionDays: sessionDays(week),
        daysOf: [...rotation.map((t) => t.sessionId), fx.UNKNOWN].map((id) => ({
          sessionId: id,
          days: daysOf(week, id),
        })),
      },
    };
  });

  // The week's cards on every fixed program and read day, nothing done, today's session done
  // today or the day before, or another one done today.
  const weekOrderCases = ZONES.flatMap((zone) =>
    inZone(zone, () =>
      [
        ...starters,
        [twice, programs[twice]!] as [string, StoredPrograms],
        [undated, programs[undated]!] as [string, StoredPrograms],
      ].flatMap(([program, p]) =>
        [...READ_DAYS, fx.THU].flatMap((today) => {
          const rotation = rotationOf(p);
          const week = fixedWeek(p, rotation);
          const s = week?.[weekdayOf(today)] ?? rotation[0]!;
          const other = rotation.find((t) => t.sessionId !== s.sessionId) ?? s;
          const histories: [string, Done[]][] = [
            ["nothing done", []],
            ["its session done today", [fx.did(s.code, s.sessionId, today)]],
            ["its session done the day before", [fx.did(s.code, s.sessionId, addDays(today, -1))]],
            ["another session done today", [fx.did(other.code, other.sessionId, today)]],
          ];
          return histories.map(([name, workouts]) => ({
            name: `${zone}: ${program}, on ${today}: ${name}`,
            timeZone: zone,
            program,
            workouts: workouts.map(asRow),
            today,
            result:
              weekOrder(workouts, p, rotation, today)?.map((c) => ({
                session: pick(c.session),
                next: c.next,
                days: c.days,
              })) ?? null,
          }));
        }),
      ),
    ),
  );

  // The session done on a day, its length and work sets: across midnight, open, removed, two on
  // one day, a start written with an offset, and sets warm-up, removed or in a removed session.
  const finishedOnCases = ZONES.flatMap((zone) =>
    inZone(zone, () => {
      const night = session({
        plan: [],
        startedAt: fx.local(fx.SUN, 23, 30),
        endedAt: fx.local(fx.NEXT_MON, 0, 45),
      });
      const morning = session({
        plan: [],
        startedAt: fx.local(fx.NEXT_MON, 7),
        endedAt: fx.local(fx.NEXT_MON, 8),
      });
      const evening = session({
        plan: [],
        startedAt: fx.local(fx.NEXT_MON, 18),
        endedAt: fx.local(fx.NEXT_MON, 19, 10),
      });
      const open = session({
        plan: [],
        startedAt: fx.local(fx.NEXT_MON, 20),
        endedAt: null,
      });
      const gone = session({
        plan: [],
        startedAt: fx.local(fx.NEXT_MON, 21),
        removed: true,
      });
      const offset = session({
        plan: [],
        startedAt: "2026-10-26T09:00:00.000+09:00",
        endedAt: "2026-10-26T01:00:00.000Z",
      });
      // Started at the same instant as the morning's, ended earlier. Its ids are fixed, so the
      // cases after it keep theirs.
      const twin = { ...morning, id: seedId(0x1fff), endedAt: fx.local(fx.NEXT_MON, 7, 40) };
      const sets = [
        {
          id: seedId(0x2fff),
          workoutId: twin.id,
          slotIndex: 0,
          position: workPosition(1),
          exerciseId: BENCH,
          warmup: false,
          weightKg: 70,
          reps: 5,
          rir: 1,
          doneAt: twin.startedAt,
          removed: false,
        },
        done(night, 1, 60, 8),
        done(night, 2, 60, 7),
        warm(night, 0, 40, 5),
        done(night, 3, 60, 6, { removed: true }),
        done(evening, 1, 80, 5),
        done(gone, 1, 80, 5),
      ];
      const histories: [string, Done[]][] = [
        ["nothing", []],
        ["started late on Sunday", [night]],
        ["two on Monday, the evening last", [night, morning, evening]],
        ["two on Monday, the other order", [evening, morning]],
        ["open and removed aside", [morning, open, gone]],
        ["a start written with an offset", [offset, morning]],
        ["two started at one instant", [morning, twin]],
        ["two started at one instant, the other order", [twin, morning]],
      ];
      return histories.flatMap(([name, workouts]) =>
        [fx.SUN, fx.NEXT_MON, "2026-10-27"].map((day) => {
          const h = { workouts: workouts as Workout[], sets };
          const r = finishedOnDay(h, day);
          return {
            name: `${zone}: ${name}, on ${day}`,
            timeZone: zone,
            history: asHistory(h),
            day,
            result: r && { workout: r.workout.id, durationMs: r.durationMs, workSets: r.workSets },
          };
        }),
      );
    }),
  );

  // Work sets of each session of a history: warm-ups and removed sets left out, a removed session
  // holds none.
  const counted = session({ plan: [], startedAt: fx.local(fx.MON, 18) });
  const dropped = session({ plan: [], startedAt: fx.local(fx.TUE, 18), removed: true });
  const setsHistory = {
    workouts: [counted, dropped] as Workout[],
    sets: [
      done(counted, 1, 60, 8),
      done(counted, 2, 60, 8),
      warm(counted, 0, 40, 5),
      done(counted, 3, 60, 8, { removed: true }),
      done(dropped, 1, 60, 8),
    ],
  };
  const workSetsCases = [counted.id, dropped.id, fx.UNKNOWN].map((workoutId, i) => ({
    name: ["a session kept", "a session removed", "no such session"][i]!,
    history: asHistory(setsHistory),
    workoutId,
    result: workSetsOf(setsHistory, workoutId),
  }));

  // The last session done as a rotation session: by its id or, with none, its letter; open,
  // removed and other sessions aside; the latest start as text.
  const rot = rotationOf(fx.stored(3));
  const ended = (
    code: string,
    sessionId: string | null,
    day: string,
    patch: Partial<Workout> = {},
  ) =>
    session({
      plan: [],
      sessionCode: code,
      sessionId,
      startedAt: `${day}T17:00:00.000Z`,
      endedAt: `${day}T18:00:00.000Z`,
      ...patch,
    });
  // Started at one instant, the second ended earlier. Their ids are fixed, so the cases after
  // them keep theirs.
  const sameStart = [0x1ffd, 0x1ffe].map((n, i) => ({
    id: seedId(n),
    sessionCode: "A",
    sessionId: fx.S(0),
    plan: [],
    startedAt: `${fx.MON}T17:00:00.000Z`,
    endedAt: `${fx.MON}T${i ? "17:30" : "18:00"}:00.000Z`,
    note: null,
    exerciseNotes: {},
    removed: false,
  }));
  const lastHistories: [string, Workout[]][] = [
    ["nothing done", []],
    ["by its id", [ended("A", fx.S(0), fx.MON), ended("A", fx.S(0), fx.WED)]],
    ["by its letter", [ended("B", null, fx.TUE)]],
    ["its letter under another id", [ended("A", fx.S(1), fx.TUE)]],
    [
      "open and removed after it",
      [
        ended("A", fx.S(0), fx.MON),
        ended("A", fx.S(0), fx.TUE, { endedAt: null }),
        ended("A", fx.S(0), fx.WED, { removed: true }),
      ],
    ],
    ["the latest last in the list", [ended("C", fx.S(2), fx.THU), ended("C", fx.S(2), fx.SAT)]],
    ["the latest first in the list", [ended("C", fx.S(2), fx.SAT), ended("C", fx.S(2), fx.THU)]],
    ["two started at one instant", sameStart],
    ["two started at one instant, the other order", [...sameStart].reverse()],
  ];
  const lastFinishedCases = lastHistories.flatMap(([name, workouts]) =>
    rot.map((t) => ({
      name: `${name}, session ${t.code}`,
      workouts: workouts.map(asRow),
      session: pick(t),
      result: lastFinished(workouts, t)?.id ?? null,
    })),
  );

  // The live programs by id, and choosing one: live, removed, unknown, already active.
  const two = fx.stored(1);
  const listed: [string, StoredPrograms][] = [
    ["the starting program", SEED],
    ["two programs", two],
    [
      "programs out of order, one removed",
      {
        ...two,
        programs: [
          { ...two.programs[1]!, id: seedId(0xa05) },
          { ...two.programs[0]!, removed: true },
          { ...two.programs[1]!, id: seedId(0xa03) },
          ...SEED.programs,
          two.programs[1]!,
        ],
      },
    ],
    [
      "every program removed",
      { ...two, programs: two.programs.map((x) => ({ ...x, removed: true })) },
    ],
  ];
  const programOrderCases = listed.map(([name, stored]) => ({
    name,
    stored,
    result: programOrder(stored).map((x) => x.id),
  }));
  const removedP2 = {
    ...two,
    programs: two.programs.map((x) => (x.id === fx.P2 ? { ...x, removed: true } : x)),
  };
  const chooseCases = (
    [
      ["another live program", two, fx.P2],
      ["the active program", two, two.activeId!],
      ["a removed program", removedP2, fx.P2],
      ["an unknown program", two, fx.UNKNOWN],
      [
        "the starting program",
        { ...two, programs: [...two.programs, ...SEED.programs] },
        SEED.activeId!,
      ],
    ] as [string, StoredPrograms, string][]
  ).map(([name, stored, programId]) => ({
    name,
    stored,
    programId,
    at: AT,
    // The web's switcher returns before the rule for the program already active; the native rule
    // holds that check itself, so a second tap never moves the time the rotation counts from.
    result: programId === stored.activeId ? null : chooseActive(stored, programId, AT),
  }));

  return {
    programs,
    dayPlan: dayPlanCases,
    fixedWeek: fixedWeekCases,
    weekOrder: weekOrderCases,
    finishedOn: finishedOnCases,
    workSetsOf: workSetsCases,
    lastFinished: lastFinishedCases,
    programOrder: programOrderCases,
    chooseActive: chooseCases,
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

// The toolkit's own rules: the one-rep max, a bar's loading, the loss projection, BMI and body
// fat. A case whose input the rule refuses has a null result. The projection reads a day, so its
// cases carry the zone they were computed in.
const refused = <T>(make: () => T): T | null => {
  try {
    return make();
  } catch {
    return null;
  }
};

function toolkitVectors() {
  const oneRepMaxCases = [80, 100, 62.5, 0, -80].flatMap((weightKg) =>
    [0, 1, 2.5, 5, 6, 10, 11, 12, 13].map((reps) => ({
      weightKg,
      reps,
      epley: epley(weightKg, reps),
      brzycki: brzycki(weightKg, reps),
      result: refused(() => oneRepMax(weightKg, reps)),
    })),
  );

  const presets = Object.entries(PLATE_PRESETS);
  const custom: [string, number, readonly number[]][] = [
    ["with 1.25 kg plates", 20, [20, 10, 5, 2.5, 1.25]],
    ["no plates", 20, []],
    ["repeated, zero and negative plates", 20, [20, 20, 0, -5]],
    ["pounds", LB_PLATES.bar, LB_PLATES.plates],
    ["a 15 kg bar", 15, STANDARD_PLATES_KG],
  ];
  const bars: [string, number, readonly number[]][] = [
    ...presets.map(([name, p]): [string, number, readonly number[]] => [name, p.barKg, p.platesKg]),
    ...custom,
  ];
  const targets = [
    0, 15, 20, 20.5, 21, 22.5, 41.2, 60, 62.5, 75, 90, 100, 101, 135, 225, 315, 333.3, 1000, 1000.5,
  ];
  const loadBarCases = bars.flatMap(([name, barKg, platesKg]) =>
    targets.map((targetKg) => ({
      name: `${name}: ${targetKg}`,
      targetKg,
      barKg,
      platesKg,
      result: refused(() => loadBar(targetKg, barKg, platesKg)),
      nearest: refused(() => nearestLoading(targetKg, barKg, platesKg)),
    })),
  );
  const refusedBars = [0, -20].map((barKg) => ({
    name: `a bar of ${barKg}`,
    targetKg: 60,
    barKg,
    platesKg: PLATE_PRESETS.gym.platesKg,
    result: refused(() => loadBar(60, barKg, PLATE_PRESETS.gym.platesKg)),
    nearest: null,
  }));
  const iwfColorCases = [...STANDARD_PLATES_KG, 7.5, 45, 0].map((kg) => ({
    kg,
    color: iwfColor(kg),
  }));

  // The projection starts from a day in Paris: the day before summer time ends, the last week of
  // the year and a day of February in a leap year.
  const zone = "Europe/Paris";
  const days = ["2026-10-24", "2026-12-28", "2028-02-27"];
  const losses: [number, number][] = [
    [82, 75],
    [85, 78],
    [80, 79.9],
    [80, 80],
    [80, 85],
    [120, 70],
  ];
  const rates = [0.2, 0.25, 0.5, 0.7, 0.75, 1, 1.05, 1.5, 1.55, 2.5, 2.55];
  const projectLossCases = inZone(zone, () =>
    days.flatMap((today) =>
      losses.flatMap(([currentKg, targetKg]) =>
        rates.map((pctPerWeek) => {
          const local = new Date(
            Number(today.slice(0, 4)),
            Number(today.slice(5, 7)) - 1,
            Number(today.slice(8, 10)),
          );
          const p = refused(() => projectLoss(currentKg, targetKg, pctPerWeek, local));
          return {
            name: `${today}: ${currentKg} to ${targetKg} kg at ${pctPerWeek} %`,
            zone,
            today,
            currentKg,
            targetKg,
            pctPerWeek,
            result:
              p === null || p.kind !== "ok"
                ? p
                : {
                    kind: p.kind,
                    weeksLow: p.weeksLow,
                    weeksHigh: p.weeksHigh,
                    dateLow: toISODate(p.dateLow),
                    dateHigh: toISODate(p.dateHigh),
                  },
          };
        }),
      ),
    ),
  );
  const rateCases = rates.map((pct) => ({
    pct,
    warning: rateWarning(pct),
    kgPerWeek: kgPerWeek(82, pct),
  }));
  const slowWeeksCases = [1, 2, 3, 10, 12, 13, 52, 100].map((weeks) => ({
    weeks,
    slow: slowWeeks(weeks),
  }));

  const bmiCases = [
    [77, 178],
    [75, 175],
    [80.9, 180],
    [99.8, 200],
    [73.8, 200],
    [30, 230],
    [300, 120],
    [29, 180],
    [301, 180],
    [80, 119],
    [80, 231],
  ].map(([weightKg, heightCm]) => ({
    weightKg,
    heightCm,
    result: refused(() => bmi(weightKg!, heightCm!)),
  }));
  const bmiBandCases = [10, 18.49, 18.5, 24.99, 25, 29.99, 30, 34.99, 35, 60].map((value) => ({
    value,
    band: bmiBand(value),
    professional: bmiSuggestsProfessional(value),
  }));

  // Each formula's girths at the edges of the range shown: the waist in hundredths of a
  // centimetre where the rounded percent first reaches 2 and last stays at 75.
  const bases: NavyInput[] = [
    { formula: "male", heightCm: 178, neckCm: 40, waistCm: 0 },
    { formula: "female", heightCm: 165, neckCm: 33, waistCm: 0, hipCm: 90 },
  ];
  const edges = bases.flatMap((base) => {
    const percentAt = (waistCm: number) => {
      const r = navyBodyFat({ ...base, waistCm });
      return r.kind === "invalid-girths" ? null : Math.round(r.exact);
    };
    const waists: number[] = [];
    let previous: number | null = null;
    for (let c = 1; c <= 40_000; c++) {
      const p = percentAt(c / 100);
      const crosses = (edge: number) =>
        previous !== null && p !== null && previous < edge && p >= edge;
      if (crosses(NAVY_RANGE_PCT.min) || crosses(NAVY_RANGE_PCT.max + 1)) {
        waists.push((c - 1) / 100, c / 100);
      }
      previous = p;
    }
    return waists.map((waistCm) => ({ ...base, waistCm }));
  });
  const navyInputs: NavyInput[] = [
    { formula: "male", heightCm: 177.8, neckCm: 39.37, waistCm: 86.36 },
    { formula: "female", heightCm: 165.1, neckCm: 33.02, waistCm: 76.2, hipCm: 99.06 },
    { formula: "male", heightCm: 178, neckCm: 40, waistCm: 40 },
    { formula: "male", heightCm: 178, neckCm: 45, waistCm: 40 },
    { formula: "female", heightCm: 165, neckCm: 200, waistCm: 70, hipCm: 90 },
    { formula: "female", heightCm: 165, neckCm: 33, waistCm: 70 },
    { formula: "male", heightCm: 178, neckCm: 40, waistCm: 41 },
    { formula: "male", heightCm: 0, neckCm: 40, waistCm: 90 },
    ...edges,
  ];
  // log10 differs in its last bits between Node versions, so the exact figure is kept to 12
  // decimals: the Swift test compares it within 1e-9, and the file stays the same on every runner.
  const navyCases = navyInputs.map((input) => {
    const result = navyBodyFat(input);
    return {
      input,
      result: "exact" in result ? { ...result, exact: Number(result.exact.toFixed(12)) } : result,
    };
  });
  const ages = [-1, 18, 19, 19.5, 20, 39, 39.5, 40, 59, 60, 79, 79.5, 80, 85];
  const references: BodyFatReference[] = ["standard", "asian"];
  const gallagherCases = (["female", "male"] as const).flatMap((formula) =>
    references.flatMap((reference) =>
      ages.map((ageYears) => ({
        formula,
        reference,
        ageYears,
        group: ageGroup(ageYears),
        result: gallagherThresholds(formula, ageYears, reference),
      })),
    ),
  );
  const thresholds = { at18_5: 8, at25: 20, at30: 25 };
  const bodyFatBandCases = [2, 7, 8, 19, 20, 24, 25, 75].map((percent) => ({
    percent,
    thresholds,
    band: bodyFatBand(percent, thresholds),
  }));

  // Home's « Activité » line for one day: activities of other days and removed ones left out,
  // the steps counted as one. Rows travel as the server sends them.
  const DAY = "2026-11-06";
  type Row = ReturnType<typeof asActivity>;
  const activity = (date: string, kind: Activity["kind"], removed = false, i = 0): Row =>
    asActivity({ date, kind, removed }, i);
  const asRule = ({ type, cardioType, climbColor, ...row }: Row): Activity => ({
    ...row,
    kind: type,
    cardioType: cardioType as Activity["cardioType"],
    climbColor: climbColor as Activity["climbColor"],
  });
  const steps = (date: string, value: number | null): StepsLog => ({ date, steps: value });
  const summaries: [string, Row[], StepsLog[]][] = [
    ["none", [], []],
    ["one climb", [activity(DAY, "climbing")], []],
    ["steps only", [], [steps(DAY, 8437)]],
    [
      "three, the steps counted as one",
      [activity(DAY, "climbing", false, 1), activity(DAY, "cardio", false, 2)],
      [steps(DAY, 8437)],
    ],
    ["one and the steps", [activity(DAY, "cardio", false, 3)], [steps(DAY, 12000)]],
    [
      "another day's and a removed one left out",
      [activity(addDays(DAY, -1), "climbing", false, 4), activity(DAY, "cardio", true, 5)],
      [steps(addDays(DAY, 1), 5000)],
    ],
    ["deleted steps", [], [steps(DAY, null)]],
    ["zero steps", [], [steps(DAY, 0)]],
  ];
  const activitySummaryCases = summaries.map(([name, activities, logs]) => {
    const r = activitySummary(activities.map(asRule), logs, DAY);
    return {
      name,
      activities,
      logs: logs.map((l) => ({ ...l, stepsAt: AT })),
      day: DAY,
      result: r.kind === "activity" ? { kind: r.kind, id: r.activity.id } : r,
    };
  });
  const stepsOfCases = [
    ["absent", [steps(addDays(DAY, -1), 3000)]],
    ["typed", [steps(addDays(DAY, -1), 3000), steps(DAY, 8437)]],
    ["deleted", [steps(DAY, null)]],
    ["no day", []],
  ].map(([name, logs]) => ({
    name,
    logs: (logs as StepsLog[]).map((l) => ({ ...l, stepsAt: AT })),
    day: DAY,
    result: stepsOf(logs as StepsLog[], DAY),
  }));
  // The year alone counts: the day before and after a birthday, and either side of New Year.
  const ageInCases = [
    [1990, "2026-03-14"],
    [1990, "2026-03-15"],
    [1990, "2026-12-31"],
    [1990, "2027-01-01"],
    [2011, "2026-01-01"],
    [1926, "2026-12-31"],
  ].map(([birthYear, today]) => ({
    birthYear,
    today,
    result: ageIn(birthYear as number, today as string),
  }));

  // The steps a Health import writes over today and the 6 days before: an empty day, a deleted
  // one, the phone's own value followed, a value typed elsewhere kept, past the bound, no
  // samples, unchanged, and a fractional total.
  const week = Array.from({ length: 7 }, (_, i) => addDays(DAY, i - 6));
  const importCases: [string, (number | null)[], [string, number | null][], [string, number][]][] =
    [
      ["empty days", [8437, 8436.6, 0, 100_000, 100_001, null, 12.5], [], []],
      [
        "stored values",
        [9120, 9120, 9120, 9120, 9120, 9120, 9120],
        [
          [week[0]!, null],
          [week[1]!, 8437],
          [week[2]!, 6000],
          [week[3]!, 6000],
          [week[4]!, 9120],
          [week[5]!, 9120],
        ],
        [
          [week[1]!, 8437],
          [week[3]!, 8437],
          [week[4]!, 9120],
          [week[6]!, 500],
        ],
      ],
      ["no samples", [null, null, null, null, null, null, null], [[week[6]!, 3000]], []],
    ];
  const stepsToWriteCases = importCases.map(([name, totals, stored, written]) => {
    const days = week.map((date, i) => ({ date, total: totals[i] ?? null }));
    return {
      name,
      days,
      rows: Object.fromEntries(stored),
      own: Object.fromEntries(written),
      result: stepsToWrite(days, new Map(stored), new Map(written)),
    };
  });

  // The library's search on a slice of the library, plus one accented name the library lacks:
  // accents, case, two words in any order, a muscle, an equipment, all three, and no match.
  const library: Exercise[] = [
    ...EXERCISES.filter((e) => /bench|curl|45°|squat/i.test(e.name)),
    {
      id: "belay:elevation-laterale",
      name: "Élévation latérale",
      primary: ["side_delts"],
      secondary: [],
      equipment: "dumbbell",
      incrementKg: 1,
      measure: "reps",
    },
  ];
  const searches: [string, Filters][] = [
    ["everything", { query: "", muscle: null, equipment: null }],
    ["blank", { query: "   ", muscle: null, equipment: null }],
    ["case", { query: "BENCH", muscle: null, equipment: null }],
    ["accents in the query", { query: "sléd  45°", muscle: null, equipment: null }],
    ["accents in the name", { query: "elevation LATERALE", muscle: null, equipment: null }],
    ["two words, any order", { query: "press bench", muscle: null, equipment: null }],
    ["every word, not any", { query: "bench squat", muscle: null, equipment: null }],
    ["a muscle", { query: "", muscle: "chest", equipment: null }],
    ["a word and a muscle", { query: "curl", muscle: "forearms", equipment: null }],
    ["an equipment", { query: "", muscle: null, equipment: "barbell" }],
    ["all three", { query: "bench", muscle: "chest", equipment: "barbell" }],
    ["no match", { query: "zzz", muscle: null, equipment: null }],
  ];
  const filterCases = searches.map(([name, filters]) => ({
    name,
    ...filters,
    result: filterExercises(library, filters).map((e) => e.id),
  }));

  return {
    toolkit: {
      library: library.map(toRow),
      filterExercises: filterCases,
      bounds: {
        supplementSuggestions: SUPPLEMENT_SUGGESTIONS,
        reliableMaxReps: RELIABLE_MAX_REPS,
        maxReps: MAX_REPS,
        lbPlates: LB_PLATES,
        standardPlatesKg: STANDARD_PLATES_KG,
        standardBarsKg: STANDARD_BARS_KG,
        ratePresets: RATE_PRESETS,
        rateMinPct: RATE_MIN_PCT,
        rateMaxPct: RATE_MAX_PCT,
        rateStepPct: RATE_STEP_PCT,
        bmiThresholds: BMI_THRESHOLDS,
        navyRangePct: NAVY_RANGE_PCT,
      },
      oneRepMax: oneRepMaxCases,
      loadBar: [...loadBarCases, ...refusedBars],
      iwfColor: iwfColorCases,
      projectLoss: projectLossCases,
      rateWarning: rateCases,
      slowWeeks: slowWeeksCases,
      bmi: bmiCases,
      bmiBand: bmiBandCases,
      navyBodyFat: navyCases,
      gallagher: gallagherCases,
      bodyFatBand: bodyFatBandCases,
      activitySummary: activitySummaryCases,
      stepsOf: stepsOfCases,
      ageIn: ageInCases,
      stepsToWrite: stepsToWriteCases,
    },
  };
}

// The weight units: each conversion in kg and lb at loads from the bar's empty end to the set's
// top, and at their pound readings; the steps, the bounds in pounds, the increments, the pound
// plates, and the read-back of a prefill confirmed as shown. Figures are kept to 12 decimals, as
// a division by the pound's factor differs in its last bits between engines.
function unitVectors() {
  const r12 = (n: number | null) => (n === null ? null : Number(n.toFixed(12)));
  const units: WeightUnit[] = ["kg", "lb"];
  const loadsKg = [0, 0.25, 20, 99.75, 100, 102, 400, 500];
  const values = [
    ...new Set(
      [
        ...loadsKg,
        ...loadsKg.flatMap((kg) => [kgToLb(kg), loadFromKg(kg, "lb"), weighingFromKg(kg, "lb")]),
        80.4,
        177.25,
      ].map((n) => r12(n)!),
    ),
  ].sort((a, b) => a - b);
  const unitFns: [string, (v: number, u: WeightUnit) => number][] = [
    ["kgFromLoad", kgFromLoad],
    ["loadFromKg", loadFromKg],
    ["kgFromWeighing", kgFromWeighing],
    ["weighingFromKg", weighingFromKg],
  ];
  const conversions = values.flatMap((value) => [
    { fn: "kgToLb", value, unit: "lb", result: r12(kgToLb(value)) },
    { fn: "lbToKg", value, unit: "lb", result: r12(lbToKg(value)) },
    ...unitFns.flatMap(([fn, f]) =>
      units.map((unit) => ({ fn, value, unit, result: r12(f(value, unit)) })),
    ),
  ]);
  const stepCases = [0.1, 0.25, 0.5, 1, 2.5, 5, 0.3].flatMap((stepKg) =>
    units.map((unit) => ({ stepKg, unit, result: stepIn(stepKg, unit) })),
  );
  const ranges: [string, { min: number; max: number }, number][] = [
    ["a set", SET_KG, SET_KG.step],
    ["a weigh-in", WEIGHING_RANGE_KG, WEIGHING_RANGE_KG.step],
    ["a body weight", WEIGHT_RANGE_KG, 0.5],
    ["a tool's load by 0.5", { min: 1, max: 500 }, 0.5],
    ["a tool's load by 2.5", { min: 1, max: 500 }, 2.5],
  ];
  const rangeCases = ranges.flatMap(([name, range, stepKg]) =>
    units.map((unit) => {
      const step = stepIn(stepKg, unit);
      return {
        name,
        range: { min: range.min, max: range.max },
        unit,
        step,
        result: rangeIn(range, unit, step),
      };
    }),
  );
  const incrementCases = EQUIPMENT.flatMap((equipment) =>
    units.map((unit) => ({
      equipment,
      incrementKg: 2.5,
      unit,
      result: incrementIn({ equipment, incrementKg: 2.5 }, unit),
    })),
  );
  // 100 kg reads "220" lb, which converts to 99.75 kg: confirmed as shown, it stays 100.
  const shown = (kg: number) => kgFromLoad(loadFromKg(kg, "lb"), "lb");
  const readBackCases: [number, { kg: number; shownKg: number } | null][] = [
    [99.75, { kg: 100, shownKg: shown(100) }],
    [102, { kg: 100, shownKg: shown(100) }],
    [99.75, null],
    [r12(lbToKg(180))!, { kg: 81.6, shownKg: r12(lbToKg(180))! }],
    [r12(lbToKg(180.5))!, { kg: 81.6, shownKg: r12(lbToKg(180))! }],
    // Within the same tenth of a kilo as the shown value, yet not it: the typed kg stands.
    [r12(lbToKg(179.9))!, { kg: 81.6, shownKg: r12(lbToKg(180))! }],
  ];
  const loadKgFromCases: [number, WeightUnit, number | null][] = [
    [220, "lb", 100],
    [225, "lb", 100],
    [220, "lb", null],
    [137.5, "lb", null],
    [1102, "lb", null],
    [1103, "lb", null],
    [1103, "lb", 500],
    [221, "lb", 100.1],
    [1102, "lb", 600],
    [0, "lb", null],
    [-1, "lb", null],
    [82.5, "kg", 80],
    [80, "kg", 80],
    [82.3, "kg", null],
    [-1, "kg", null],
    [500.25, "kg", null],
  ];
  // The weigh-in sheet's rule: the typed value to kg on its grid, or nothing outside its range.
  const weighingKgFromCases: [number, WeightUnit][] = [
    [177.25, "lb"],
    [80.4, "kg"],
    [80.43, "kg"],
    [44, "lb"],
    [43, "lb"],
    [881.75, "lb"],
    [882, "lb"],
    [19.9, "kg"],
    [400, "kg"],
  ];
  return {
    units: {
      kgPerLb: KG_PER_LB,
      incrementLb: INCREMENT_LB,
      poundPlates: { barLb: LB_PLATES.bar, platesLb: LB_PLATES.plates },
      conversions,
      stepIn: stepCases,
      rangeIn: rangeCases,
      incrementIn: incrementCases,
      readBack: readBackCases.map(([typedKg, prefill]) => ({
        typedKg,
        prefill,
        result: readBack(typedKg, prefill ?? undefined),
      })),
      loadKgFrom: loadKgFromCases.map(([value, unit, prefillKg]) => ({
        value,
        unit,
        prefillKg,
        result: loadKgFrom(value, unit, prefillKg ?? undefined),
      })),
      weighingKgFrom: weighingKgFromCases.map(([value, unit]) => {
        const kg = kgFromWeighing(value, unit);
        return { value, unit, result: isWeighingKg(kg) ? kg : null };
      }),
    },
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

// Weigh-ins to Health and back: which ones Health should hold, the time a weigh-in's sample
// takes, each day's earliest reading, and which days the import fills. The import runs the web's
// own `importWeighings` on an in-memory account database, so the choice it made is the vector.
async function weighInVectors() {
  const ms = (s: string) => Date.parse(s);
  const NOW = ms("2026-10-10T12:00:00.000Z");
  const owner = ownerOf("u1");
  const weight = (date: string, weightKg: number | null, at = `${date}T06:00:00.000Z`) => ({
    date,
    weightKg,
    at,
  });
  const weights: WeightRow[] = [
    weight("2026-03-29", 81.2),
    weight("2026-09-20", 80.6),
    weight("2026-10-05", 80.1),
    weight("2026-10-06", 79.8),
    weight("2026-10-07", null, "2026-10-07T19:00:00.000Z"),
    weight("2026-10-08", 79.5),
    weight("2026-10-09", 410),
    weight("2026-10-10", 79.4),
    weight("2026-10-25", 79.0),
  ];
  const weighing = (kg: number, version: number): Written => ({ state: "weighing", version, kg });
  const every = Object.fromEntries(
    weights.map((r) => [weighingKey(r.date), weighing(r.weightKg ?? 80, 3)]),
  );
  const on = ms("2026-10-01T00:00:00.000Z");
  const cases: [
    string,
    {
      turnedOnAt: number | null;
      written: Record<string, Written>;
      weights?: WeightRow[];
      allowed: boolean;
      owner: string;
      now: number;
    },
  ][] = [
    ["new since the switch", { turnedOnAt: on, written: {}, allowed: true, owner, now: NOW }],
    ["each one written before", { turnedOnAt: on, written: every, allowed: true, owner, now: NOW }],
    [
      "a changed value",
      {
        turnedOnAt: on,
        written: { [weighingKey("2026-10-05")]: weighing(80, ms("2027-01-01T00:00:00.000Z")) },
        allowed: true,
        owner,
        now: NOW,
      },
    ],
    [
      "deleted and out of range once written",
      {
        turnedOnAt: on,
        written: {
          [weighingKey("2026-10-07")]: weighing(80, 2),
          [weighingKey("2026-10-09")]: weighing(81, 2),
        },
        allowed: true,
        owner,
        now: NOW,
      },
    ],
    [
      "today before 08:00",
      {
        turnedOnAt: on,
        written: {},
        allowed: true,
        owner,
        now: ms("2026-10-10T05:00:00.000Z"),
      },
    ],
    [
      "the daylight-saving days",
      {
        turnedOnAt: ms("2026-03-01T00:00:00.000Z"),
        written: {},
        allowed: true,
        owner,
        now: ms("2026-10-26T12:00:00.000Z"),
      },
    ],
    [
      "an old day written before",
      {
        turnedOnAt: on,
        written: { [weighingKey("2026-09-20")]: weighing(80, 2) },
        allowed: true,
        owner,
        now: NOW,
      },
    ],
    [
      "another owner",
      { turnedOnAt: on, written: {}, allowed: true, owner: ownerOf("u2"), now: NOW },
    ],
    [
      "imported elsewhere on and after the switch's day",
      {
        turnedOnAt: on,
        written: {},
        // The import's stamp in Paris, and the same moved on where an earlier reading replaced it.
        weights: [
          weight("2026-10-01", 80.3, "2026-09-30T22:00:00.000Z"),
          weight("2026-10-08", 79.5, "2026-10-07T22:00:00.002Z"),
        ],
        allowed: true,
        owner,
        now: NOW,
      },
    ],
    [
      "an imported day corrected by the person",
      {
        turnedOnAt: on,
        written: {},
        weights: [weight("2026-10-08", 79.7, "2026-10-08T07:15:00.000Z")],
        allowed: true,
        owner,
        now: NOW,
      },
    ],
    [
      "a typed day at an ordinary time",
      {
        turnedOnAt: on,
        written: {},
        weights: [weight("2026-10-08", 79.5, "2026-10-08T19:40:00.000Z")],
        allowed: true,
        owner,
        now: NOW,
      },
    ],
    [
      "writing weigh-ins not allowed",
      { turnedOnAt: on, written: every, allowed: false, owner, now: NOW },
    ],
  ];
  const planCases = cases.map(([name, c]) => ({
    name,
    ...c,
    result: planHealth({
      workouts: [],
      sets: [],
      weights: c.weights ?? weights,
      settings: {
        on: true,
        turnedOnAt: c.turnedOnAt,
        history: "no",
        importOn: false,
        importSince: null,
      },
      written: c.written,
      allowed: { workouts: false, weighings: c.allowed },
      now: c.now,
      owner: c.owner,
    }),
  }));

  const times = [
    ["2026-10-05", NOW],
    ["2026-10-10", NOW],
    ["2026-10-10", ms("2026-10-10T05:00:00.000Z")],
    ["2026-03-29", NOW],
    ["2026-10-25", NOW],
    ["1900-01-01", NOW],
  ] as const;

  const sample = (iso: string, kg: number): HealthSample => ({ startedAt: ms(iso), kg });
  const readings = [
    sample("2026-10-05T05:10:00.000Z", 80.04),
    sample("2026-10-05T04:50:00.000Z", 80.21),
    sample("2026-10-05T20:00:00.000Z", 79.6),
    sample("2026-10-05T22:30:00.000Z", 79.96),
    sample("2026-10-06T07:00:00.000Z", 19.9),
    sample("2026-10-06T08:00:00.000Z", 400.04),
    sample("2026-10-06T09:00:00.000Z", 400.06),
    sample("2026-09-30T21:59:00.000Z", 81),
  ];
  const sorted = (m: Map<string, HealthSample>) => Object.fromEntries([...m].sort());
  const earliest = [
    ["readings of a few days", readings, "2026-10-01"],
    ["from a later day", readings, "2026-10-06"],
    ["none", [], "2026-10-01"],
  ] as const;

  // The import against an account database held in memory: the weigh-ins, the queue and the
  // Health state, as the web's import reads and writes them.
  const floor = toISODate(new Date(HISTORY_SINCE));
  async function imported(
    rows: WeightRow[],
    filled: HealthImport["filled"],
    samples: HealthSample[],
    now: number,
  ) {
    const stores: Record<string, Map<unknown, unknown>> = {
      weights: new Map(rows.map((r) => [r.date, r])),
      outbox: new Map(),
      meta: new Map<unknown, unknown>([
        [
          SETTINGS_KEY,
          { on: true, turnedOnAt: 0, history: "no", importOn: true, importSince: HISTORY_SINCE },
        ],
        [IMPORT_KEY, { anchor: null, filled, historyDone: false }],
      ]),
    };
    const queued: Change[] = [];
    const db = {
      transaction: () => ({
        objectStore: (name: string) => ({
          get: async (key: unknown) => stores[name]!.get(key),
          put: async (value: { date?: string }, key?: unknown) => {
            stores[name]!.set(key ?? value.date, value);
          },
          add: async (value: { change: Change }) => {
            queued.push(value.change);
          },
        }),
        done: Promise.resolve(),
      }),
    };
    await importWeighings(db as never, samples, "next", new Date(now), {
      anchor: null,
      since: HISTORY_SINCE,
      historyDone: false,
    });
    return queued;
  }
  const typed = weight("2026-10-05", 81.5, "2026-10-05T18:00:00.000Z");
  const mine = { at: "2026-10-04T22:00:00.000Z", startedAt: ms("2026-10-05T06:00:00.000Z") };
  const ownRow = weight("2026-10-05", 80.5, mine.at);
  const importCases: [string, WeightRow[], HealthImport["filled"], HealthSample[], number][] = [
    ["empty days filled", [], {}, readings, NOW],
    ["a typed day kept", [typed], {}, readings, NOW],
    ["a deleted day kept", [weight("2026-10-05", null)], {}, readings, NOW],
    [
      "an earlier reading replaces this import's own",
      [ownRow],
      { "2026-10-05": mine },
      readings,
      NOW,
    ],
    [
      "a later reading leaves this import's own",
      [ownRow],
      { "2026-10-05": mine },
      [sample("2026-10-05T07:00:00.000Z", 79)],
      NOW,
    ],
    [
      "an import's day edited since kept",
      [weight("2026-10-05", 80.5, "2026-10-05T07:30:00.000Z")],
      { "2026-10-05": mine },
      readings,
      NOW,
    ],
    [
      "tomorrow's reading waits",
      [],
      {},
      [sample("2026-10-10T23:30:00.000Z", 79.3), sample("2026-10-10T08:00:00.000Z", 79.4)],
      NOW,
    ],
    ["a reading days ahead dropped", [], {}, [sample("2026-10-14T08:00:00.000Z", 79.3)], NOW],
    [
      "the first read from the history floor",
      [],
      {},
      [sample("1899-12-31T12:00:00.000Z", 70), sample("1900-01-01T07:00:00.000Z", 70.1)],
      NOW,
    ],
  ];
  const importChoice = [];
  for (const [name, rows, filled, samples, now] of importCases) {
    importChoice.push({
      name,
      rows,
      filled,
      samples,
      now,
      result: await imported(rows, filled, samples, now),
    });
  }

  return {
    weighInBounds: {
      weighingKey: weighingKey("2026-10-10"),
      historyDay: floor,
      importStampMs: IMPORT_STAMP_MS,
    },
    weights,
    planWeighIns: planCases,
    sampleTime: times.map(([date, now]) => ({ date, now, result: sampleTime(date, now) })),
    earliestPerDay: earliest.map(([name, samples, fromDay]) => ({
      name,
      samples,
      fromDay,
      result: sorted(earliestPerDay(samples, fromDay)),
    })),
    importChoice,
  };
}

// The body rules: the weigh-ins' averages and weeks, the loss range, measures, intake, creatine
// and the tools intake reads its figures from. The day rules run on calendar days alone, so the
// cases cross a week boundary and both of Paris's daylight-saving changes without a zone.
function bodyVectors() {
  const w = (date: string, weightKg: number): Weighing => ({ date, weightKg });
  const run = (monday: string, kgs: number[]) => kgs.map((kg, i) => w(addDays(monday, i), kg));
  // A seeded generator (mulberry32), so the random cases are the same on every run.
  const random = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  // Wednesday after the autumn change (25 October 2026); the current week runs from 26 October.
  const TODAY = "2026-10-28";
  const before = run("2026-09-21", [80, 80.4, 80.2, 80.6]);
  const last = run("2026-09-28", [79.8, 79.6, 80, 79.8]);
  const named: [string, Weighing[], string][] = [
    ["none", [], TODAY],
    [
      "three in the 7 days",
      [w("2026-10-01", 80), w("2026-10-03", 81), w("2026-10-07", 82)],
      "2026-10-07",
    ],
    [
      "four in the 7 days",
      [w("2026-10-01", 80), w("2026-10-03", 81), w("2026-10-07", 82), w("2026-10-05", 79)],
      "2026-10-07",
    ],
    [
      "one older than 6 days",
      [w("2026-09-30", 90), ...run("2026-10-04", [80, 80, 80, 80])],
      "2026-10-07",
    ],
    ["through 29 February", run("2028-02-26", [80, 81, 82, 83]), "2028-03-04"],
    ["two complete weeks", [...before, ...last], "2026-10-07"],
    [
      "seven in the current week",
      [...last, ...run("2026-10-05", [79, 79, 79, 79, 79, 79, 79])],
      "2026-10-11",
    ],
    ["one in the current week", [...last, w("2026-10-06", 79.4)], "2026-10-07"],
    [
      "two in the current week",
      [...last, w("2026-10-06", 79.4), w("2026-10-07", 79)],
      "2026-10-07",
    ],
    ["the current week empty", last, "2026-10-07"],
    [
      "a loss never from a week in progress",
      [w("2026-10-06", 80), w("2026-10-12", 79)],
      "2026-10-11",
    ],
    [
      "an insufficient week before",
      [...run("2026-09-21", [80, 80.4, 80.2]), ...last],
      "2026-10-07",
    ],
    ["a gain", [...before, ...run("2026-09-28", [80.5, 80.5, 80.5, 80.5])], "2026-10-07"],
    ["an empty week between two", [...run("2026-09-14", [81, 81, 81, 81]), ...last], "2026-10-07"],
    ["a week across the new year", run("2026-12-28", [80, 80, 80, 80, 80, 80, 80]), "2027-01-04"],
    ["a weigh-in after today", [w("2026-10-12", 80)], "2026-10-11"],
    [
      "across the spring change",
      run("2026-03-26", [70.2, 70.1, 70, 69.9, 69.8, 69.9, 69.7]),
      "2026-04-01",
    ],
    ["across the autumn change", run("2026-10-22", [80.3, 80.1, 80, 79.9, 79.8, 79.6]), TODAY],
    [
      "a Sunday and the Monday after",
      [...run("2026-10-15", [81, 81.2, 81.1, 80.9]), w("2026-10-19", 80.8)],
      "2026-10-19",
    ],
    [
      "out of order with two on one day",
      [
        w("2026-10-07", 81),
        w("2026-10-05", 80.1),
        w("2026-10-06", 80.3),
        w("2026-10-05", 80.7),
        w("2026-10-04", 80),
      ],
      "2026-10-07",
    ],
    ["near the grid", run("2026-10-05", [80.01, 79.99, 80.04, 44.31]), "2026-10-08"],
  ];
  // 0 to 30 weigh-ins over the 6 weeks to today, with gaps where the draw leaves days out.
  const draw = random(20261113);
  const generated: [string, Weighing[], string][] = Array.from({ length: 31 }, (_, n) => {
    const days = new Set<number>();
    while (days.size < n) days.add(Math.floor(draw() * 42));
    const ws = [...days].map((d) => w(addDays(TODAY, -d), roundTo(76 + draw() * 8, 0.1)));
    return [`${n} drawn`, ws, TODAY];
  });
  const weighings = [...named, ...generated].map(([name, ws, today]) => {
    const first = ws.reduce((m, x) => (x.date < m ? x.date : m), today);
    const from = addDays(first, -3);
    return {
      name,
      weighings: ws,
      today,
      from,
      series: movingAverageSeries(ws, from, today),
      average7: movingAverage7(ws, today),
      latest: latestMovingAverage(ws, today),
      weeks: weeklySummaries(ws, today),
    };
  });

  const days = [
    "2025-12-29",
    "2026-01-01",
    "2026-03-28",
    "2026-03-29",
    "2026-03-30",
    "2026-10-05",
    "2026-10-11",
    "2026-10-24",
    "2026-10-25",
    "2026-10-26",
    "2027-01-03",
    "2028-02-28",
    "2028-02-29",
    "1900-01-01",
  ];
  const addCases = days.flatMap((date) =>
    [-366, -7, -1, 0, 1, 6, 7, 365].map((n) => ({ date, days: n, result: addDays(date, n) })),
  );
  const weekStarts = days.map((date) => ({ date, result: isoWeekStart(date) }));

  const kgs = [
    20,
    19.9,
    20.1,
    400,
    400.1,
    79.8,
    79.85,
    80.3,
    0.1 + 79.7,
    80.01,
    79.99,
    80.04,
    0,
    -80,
    1e9,
  ];
  const ranges: [number, number][] = [
    [0.25, 1],
    [0.85, 0.95],
    [0.9, 1],
    [0.2, 1],
    [0.5, 1.05],
    [0.9, 0.95],
    [0.33, 1],
    [0.5, 1],
    [0.25, 0.35],
    [0.25, 0.3],
    [1, 1],
    [0.95, 0.85],
    [0.3, 0.4],
    [0.7, 0.8],
    [0, 1],
  ];
  const losses = [
    ...Array.from({ length: 161 }, (_, i) => roundTo(-0.3 + i * 0.01, 0.01)),
    0.45,
    0.449,
    0.4499999,
    0.44,
    1.04,
    1.049,
    1.05,
    0.95,
    0.25,
    0.249,
    0.2,
    0.15,
    1e-9,
    -0.05,
    -0.04,
    ((80.3 - 79.8) / 80.3) * 100,
  ];
  const targets = [DEFAULT_TARGET, { minPct: 0.25, maxPct: 0.35 }, { minPct: 0.9, maxPct: 1 }];

  const m = (
    date: string,
    waistCm: number | null,
    neckCm: number | null,
    hipCm: number | null,
  ): Measure => ({ date, waistCm, neckCm, hipCm });
  const measureCases: [string, Measure[], string][] = [
    ["none", [], "2026-10-05"],
    ["all three", [m("2026-10-06", 84.5, 38, 98)], "2026-10-05"],
    [
      "each on its own day",
      [
        m("2026-10-01", 85, null, null),
        m("2026-10-03", null, 38.5, null),
        m("2026-10-06", null, null, 97.5),
      ],
      "2026-10-05",
    ],
    [
      "a newer day without a waist",
      [m("2026-10-05", 85, 38, null), m("2026-10-07", null, 37.5, 99)],
      "2026-10-05",
    ],
    [
      "the waist of another week",
      [m("2026-09-28", 86, null, null), m("2026-10-12", 84, null, null)],
      "2026-10-05",
    ],
    [
      "two in the week",
      [m("2026-10-11", 84, null, null), m("2026-10-05", 85.5, null, null)],
      "2026-10-05",
    ],
    [
      "on the Sunday and the Monday after",
      [m("2026-10-11", 84, null, null), m("2026-10-12", 83.5, null, null)],
      "2026-10-05",
    ],
    ["nothing at all", [m("2026-10-06", null, null, null)], "2026-10-05"],
  ];
  const cmValues = [
    19.9,
    20,
    39.9,
    40,
    44.31,
    49.9,
    50,
    84.5,
    84.55,
    80,
    80.1,
    200,
    200.1,
    0.1 + 84.4,
  ];

  const l = (date: string, kcal: number | null, proteinG: number | null): IntakeLog => ({
    date,
    kcal,
    proteinG,
  });
  const intakeCases: [string, IntakeLog[], string][] = [
    ["none", [], "2026-10-05"],
    ["at the bounds", [l("2026-10-05", 0, 0), l("2026-10-06", 10_000, 500)], "2026-10-05"],
    [
      "protein on fewer days",
      [l("2026-10-05", 1850, 128), l("2026-10-06", 2100, null), l("2026-10-07", null, 140)],
      "2026-10-05",
    ],
    [
      "outside the week",
      [
        l("2026-10-04", 3000, 200),
        l("2026-10-05", 1800, 120),
        l("2026-10-11", 2000, 130),
        l("2026-10-12", 2500, 150),
      ],
      "2026-10-05",
    ],
    [
      "across the autumn change",
      [l("2026-10-25", 1900, 125), l("2026-10-26", 2050, 131)],
      "2026-10-19",
    ],
    ["deleted values", [l("2026-10-06", null, null)], "2026-10-05"],
  ];
  const intakeValues = [-1, 0, 0.5, 5, 100.5, 128, 499, 500, 501, 2130, 9999, 10_000, 10_001];

  const names = [
    "Créatine",
    "creatine",
    "CREATINE monohydrate",
    "Creatine HCl",
    "Ma créatine du matin",
    "créatine-monohydrate",
    "CRÉATINE",
    "Créatine",
    "creatines",
    "procreatine",
    "Kreatin",
    "Monohydrate",
    "Vitamine D",
    "",
    "  creatine  ",
    "crèatine",
    "creatine2",
    "2creatine",
  ];
  const labels = [
    null,
    "",
    "Semaine allégée",
    "x".repeat(80),
    "x".repeat(81),
    "\u{1F4AA}".repeat(40),
    "\u{1F4AA}".repeat(41),
    "a\nb",
    "a\rb",
    "a b",
  ];

  const creatineCases: [string, string[], string][] = [
    ["none", [], "2026-10-28"],
    ["one day", ["2026-10-01"], "2026-10-28"],
    ["daily", Array.from({ length: 20 }, (_, i) => addDays("2026-10-01", i)), "2026-10-28"],
    ["a gap of 14 days", ["2026-10-01", "2026-10-15"], "2026-10-28"],
    ["a gap of 15 days", ["2026-10-01", "2026-10-16"], "2026-10-28"],
    [
      "a gap past 14 days, then daily",
      [
        "2026-09-01",
        "2026-09-02",
        ...Array.from({ length: 10 }, (_, i) => addDays("2026-09-20", i)),
      ],
      "2026-10-28",
    ],
    ["a day after today", ["2026-10-20", "2026-10-29"], "2026-10-28"],
    [
      "repeated and out of order",
      ["2026-10-10", "2026-10-02", "2026-10-02", "2026-10-25"],
      "2026-10-28",
    ],
    ["across the autumn change", ["2026-10-24", "2026-10-25", "2026-10-26"], "2026-10-28"],
    ["a tick 24 days after the last", ["2026-09-01", "2026-09-02", "2026-09-26"], "2026-10-28"],
  ];

  const man: MifflinInput = { formula: "male", ageYears: 30, heightCm: 180, weightKg: 80 };
  const woman: MifflinInput = { formula: "female", ageYears: 40, heightCm: 165, weightKg: 60 };
  const attempt = <T>(f: () => T): T | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  const inputs: [string, MifflinInput][] = [
    ["man", man],
    ["woman", woman],
    ["youngest", { ...man, ageYears: 15 }],
    ["oldest", { ...woman, ageYears: 100 }],
    ["shortest", { ...woman, heightCm: 120 }],
    ["tallest", { ...man, heightCm: 230 }],
    ["lightest", { ...woman, weightKg: 30 }],
    ["heaviest", { ...man, weightKg: 300 }],
    ["an average to the tenth", { ...woman, weightKg: 63.4 }],
    ["age 14", { ...man, ageYears: 14 }],
    ["age 101", { ...man, ageYears: 101 }],
    ["height 119", { ...man, heightCm: 119 }],
    ["height 231", { ...man, heightCm: 231 }],
    ["weight 29", { ...man, weightKg: 29 }],
    ["weight 301", { ...man, weightKg: 301 }],
  ];
  const pals = [...PAL_LEVELS.map((p) => p.pal), 0, -1];
  const energy = inputs.flatMap(([name, input]) =>
    pals.map((pal) => ({
      name: `${name} at ${pal}`,
      input,
      pal,
      bmr: attempt(() => mifflinStJeor(input)),
      result: attempt(() => dailyEnergy(input, pal)),
    })),
  );

  const goals: ProteinGoal[] = ["maintain", "cut", "gain"];
  const fats = [undefined, 1.9, 2, 15, 25, 28.5, 40, 45, 75, 75.1];
  const protein = [30, 40, 41, 63, 63.4, 70, 80, 82, 100, 150, 300, 0, -5].flatMap((weightKg) =>
    goals.flatMap((goal) =>
      fats.map((bodyFatPct) => ({
        weightKg,
        goal,
        bodyFatPct: bodyFatPct ?? null,
        result: attempt(() => proteinRange(weightKg, goal, bodyFatPct)),
      })),
    ),
  );

  const profiles: [string, Profile][] = [
    ["empty", { formula: null, birthYear: null, heightCm: null }],
    ["full", { formula: "female", birthYear: 1990, heightCm: 168 }],
    ["age 15 and 100", { formula: "male", birthYear: 2011, heightCm: 230 }],
    ["age 14", { formula: "male", birthYear: 2012, heightCm: 120 }],
    ["age 101", { formula: "male", birthYear: 1925, heightCm: 119 }],
    ["age 100", { formula: null, birthYear: 1926, heightCm: 231 }],
  ];
  const bodies: [string, Weighing[], Measure[]][] = [
    ["nothing", [], []],
    [
      "an average",
      run("2026-10-22", [80.33, 80.1, 80, 79.9, 79.8]),
      [m("2026-10-26", 84.5, 38, 98)],
    ],
    [
      "an average older than the last weigh-in",
      [...run("2026-10-01", [80, 80, 80, 80]), w("2026-10-27", 79.4)],
      [],
    ],
    [
      "one weigh-in",
      [w("2026-10-27", 25)],
      [m("2026-10-26", 30, 19.5, null), m("2026-10-29", 90, null, null)],
    ],
    ["one after today", [w("2026-10-27", 79), w("2026-10-29", 78)], []],
    ["heavy", [w("2026-10-27", 301)], [m("2026-10-25", 200, 80, 200)]],
    [
      "the average and the last weigh-in both today",
      run("2026-10-24", [80.2, 80.1, 80, 79.9, 79.7]),
      [],
    ],
    [
      "near the grid",
      run("2026-10-26", [80.01, 79.99, 80.04]),
      [m("2026-10-27", 84.55, 44.31, null)],
    ],
  ];
  const defaults = profiles.flatMap(([pname, profile]) =>
    bodies.map(([bname, ws, ms]) => ({
      name: `${pname}, ${bname}`,
      profile,
      weighings: ws,
      measures: ms,
      today: TODAY,
      result: toolDefaults({ profile, weighings: ws, measures: ms, today: TODAY }),
    })),
  );

  return {
    bounds: {
      minWeighings: MIN_WEIGHINGS,
      creatineDays: CREATINE_DAYS,
      defaultTarget: DEFAULT_TARGET,
      palLevels: PAL_LEVELS,
      cutFloorGPerKg: CUT_FLOOR_G_PER_KG,
    },
    addDays: addCases,
    isoWeekStart: weekStarts,
    isWeighingKg: kgs.map((value) => ({ value, result: isWeighingKg(value) })),
    weighings,
    isTargetRange: ranges.map(([minPct, maxPct]) => ({
      minPct,
      maxPct,
      result: isTargetRange({ minPct, maxPct }),
    })),
    inTargetRange: targets.flatMap((target) =>
      losses.map((lossPct) => ({ lossPct, target, result: inTargetRange(lossPct, target) })),
    ),
    isMeasureCm: MEASURE_FIELDS.flatMap((field) =>
      cmValues.map((value) => ({ field, value, result: isMeasureCm(field, value) })),
    ),
    measures: measureCases.map(([name, ms, weekStart]) => ({
      name,
      measures: ms,
      weekStart,
      latest: latestMeasures(ms),
      waist: weeklyWaist(ms, weekStart),
    })),
    isKcal: intakeValues.map((value) => ({ value, result: isKcal(value) })),
    isProteinG: intakeValues.map((value) => ({ value, result: isProteinG(value) })),
    intake: intakeCases.map(([name, logs, weekStart]) => ({
      name,
      logs,
      weekStart,
      result: weeklyIntake(logs, weekStart),
    })),
    isCreatineName: names.map((name) => ({ name, result: isCreatineName(name) })),
    creatineWindows: creatineCases.map(([name, takenDays, today]) => ({
      name,
      takenDays,
      today,
      result: creatineWindows(takenDays, today),
    })),
    isAnnotationLabel: labels.map((label) => ({ label, result: isAnnotationLabel(label) })),
    energy,
    protein,
    toolDefaults: defaults,
  };
}

// The science catalogue as the phone shows it in « Comment c'est calculé »: each entry's words in
// French and English, its sources cited as the web cites them, with their resolvable links.
function scienceCatalogue() {
  return Object.fromEntries(
    SCIENCE_IDS.map((id) => {
      const science = TOOL_SCIENCE[id];
      return [
        id,
        {
          label: science.label,
          sources: science.sourceIds.map((sid) => {
            const source = sourceById(sid);
            return {
              cite: `${shortAuthors(source)} ${source.year}`,
              title: source.title,
              venue: source.venue,
              links: source.identifier.map((i) => ({
                label: identifierLabel(i),
                url: identifierHref(i),
              })),
            };
          }),
          content: science.content,
        },
      ];
    }),
  );
}

// The body figure as the phone draws it: each view's outlines as absolute moves, lines and cubics,
// with the muscle each one colours and the deltoid's cut, and the thumbnail framing of every
// muscle, all as the web's body map computes them.
function bodyFigure() {
  const box = (viewBox: string) => viewBox.split(" ").map(Number);
  const view = (v: "front" | "back") => ({
    viewBox: box(VIEW_BOX[v]),
    cut: DELTOID_CUT[v],
    shapes: shapesOf(v).map((s) => ({
      muscle: s.muscle,
      clip: s.clip ?? null,
      path: absoluteCubics(s.d),
    })),
  });
  return {
    views: { front: view("front"), back: view("back") },
    gap: GAP,
    thumbnails: Object.fromEntries(
      MUSCLES.map((m) => {
        const t = thumbnailOf(m);
        return [m, { view: t.view, viewBox: box(t.viewBox) }];
      }),
    ),
  };
}

const rules = rulesVectors();
const tools = toolVectors();
const files = [
  { path: core("Tests/BelayCoreTests/Vectors/contract.json"), data: vectors },
  {
    path: core("Tests/BelayCoreTests/Vectors/rules.json"),
    data: {
      ...rules,
      ...tools,
      bounds: { ...rules.bounds, ...tools.bounds },
      ...toolkitVectors(),
      ...unitVectors(),
    },
  },
  {
    path: core("Tests/BelayCoreTests/Vectors/health.json"),
    data: { ...healthVectors(), ...(await weighInVectors()) },
  },
  {
    path: core("Tests/BelayCoreTests/Vectors/schedule.json"),
    data: { ...scheduleVectors(), ...readVectors() },
  },
  { path: core("Tests/BelayCoreTests/Vectors/body.json"), data: bodyVectors() },
  { path: core("Sources/BelayCore/Resources/seed.json"), data: SEED },
  { path: core("Sources/BelayCore/Resources/science.json"), data: scienceCatalogue() },
  { path: core("Sources/BelayCore/Resources/figure.json"), data: bodyFigure() },
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
    // Say where each file first differs, so a run on another machine shows what moved.
    for (const { path, expected } of stale) {
      let committed: string[] = [];
      try {
        committed = readFileSync(path, "utf8").split("\n");
      } catch {
        // A missing file differs from its first line.
      }
      const lines = expected.split("\n");
      const at = lines.findIndex((line, i) => line !== committed[i]);
      console.error(`${path}:${at + 1}\n  committed: ${committed[at]}\n  generated: ${lines[at]}`);
    }
    console.error("The native vectors are out of date. Run `pnpm vectors` and commit the result.");
    process.exit(1);
  }
  console.log(`The native vectors are up to date: ${cases.length} changes.`);
} else {
  for (const { path, expected } of files) writeFileSync(path, expected);
  console.log(`Wrote ${cases.length} changes to the native vectors.`);
}
