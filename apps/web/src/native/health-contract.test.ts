import type { SetRow, WeightRow, WorkoutRow } from "@belay/shared/sync/schema";
import { describe, expect, it } from "vitest";
import { kotlin, longConst, stringSet } from "@/test/kotlin";
import { body, cases, fields, swift } from "@/test/swift";
import {
  HEALTH_BATCH,
  HEALTH_OFF,
  health,
  type HealthAccess,
  type HealthHistoryAccess,
  type HealthObject,
  type HealthOutcome,
  type HealthRequest,
  type HealthSample,
  type HealthStatus,
  type Written,
} from "./health";
import {
  DAY,
  EARLIEST,
  HEALTH_KG_MAX,
  HEALTH_KG_MIN,
  planHealth,
  sessionKey,
  weighingKey,
} from "./health-plan";

// The page hands Apple Health its requests as JSON, and the iPhone app decodes them into Swift
// types that refuse any key they do not expect: a key renamed, added or dropped on one side alone
// would fail every call on a phone, where no browser test reaches. Both sides are read here.
const request = swift("App/HealthRequest.swift");
const answers = swift("App/Health.swift");
const struct = (name: string) => fields(body(request, "struct", name), "let");
const enumCases = (name: string) => cases(body(request, "enum", name));

const NOW = new Date(2026, 9, 26, 12, 0).getTime();
const ID = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01";
const session: WorkoutRow = {
  id: ID,
  sessionCode: "A",
  plan: [],
  planAt: null,
  startedAt: new Date(2026, 9, 24, 18).toISOString(),
  startedAtAt: null,
  endedAt: new Date(2026, 9, 24, 19).toISOString(),
  endedAtAt: new Date(2026, 9, 24, 19).toISOString(),
  note: null,
  noteAt: null,
  exerciseNotes: {},
  exerciseNotesAt: null,
  removed: false,
  removedAt: null,
};
const aSet: SetRow = {
  id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91",
  workoutId: ID,
  slotIndex: 0,
  position: 3,
  exerciseId: "ds:0025",
  warmup: false,
  weightKg: 80,
  reps: 8,
  seconds: null,
  rir: 1,
  doneAt: session.startedAt,
  fieldsAt: session.startedAt,
  removed: false,
  removedAt: null,
};
const day = (weightKg: number | null): WeightRow => ({
  date: "2026-10-25",
  weightKg,
  at: "2026-10-25T06:00:00.000Z",
});

// The one object Health is asked for, given the phone's rows and what it already wrote.
function planned(
  rows: { workouts?: WorkoutRow[]; weights?: WeightRow[] },
  written: Record<string, Written> = {},
): HealthObject {
  const objects = planHealth({
    workouts: rows.workouts ?? [],
    sets: [aSet],
    weights: rows.weights ?? [],
    settings: { ...HEALTH_OFF, on: true, turnedOnAt: NOW - 7 * 86_400_000, history: "asked" },
    written,
    filled: {},
    allowed: { workouts: true, weighings: true },
    now: NOW,
    owner: "0a1b2c3d",
  });
  expect(objects).toHaveLength(1);
  return objects[0]!;
}

// One object of each kind, as the page plans them.
function everyKind(): Record<HealthObject["kind"], HealthObject> {
  const workout = planned({ workouts: [session] });
  const workoutRemoved = planned(
    { workouts: [{ ...session, removed: true, removedAt: session.endedAt }] },
    { [sessionKey(ID)]: { state: "workout", version: 1, startedAt: 0, endedAt: 1 } },
  );
  const weighing = planned({ weights: [day(80)] });
  const weighingRemoved = planned(
    { weights: [day(null)] },
    { [weighingKey("2026-10-25")]: { state: "weighing", version: 1, kg: 80 } },
  );
  expect([workout.kind, workoutRemoved.kind, weighing.kind, weighingRemoved.kind]).toEqual([
    "workout",
    "workoutRemoved",
    "weighing",
    "weighingRemoved",
  ]);
  return { workout, workoutRemoved, weighing, weighingRemoved };
}
const keysOf = (o: object) => Object.keys(o).sort();

// Every value of the page's own types, checked by the compiler: one added there fails to compile
// here until it is listed, and the comparisons then fail until the native side has it.
const OPS = {
  status: true,
  authorize: true,
  apply: true,
  readWeighings: true,
} satisfies Record<HealthRequest["op"], true>;
const SCOPES = { write: true, import: true, history: true } satisfies Record<
  Extract<HealthRequest, { op: "authorize" }>["scope"],
  true
>;
const KINDS = {
  workout: true,
  workoutRemoved: true,
  weighing: true,
  weighingRemoved: true,
} satisfies Record<HealthObject["kind"], true>;
const OUTCOMES = {
  written: true,
  removed: true,
  overlap: true,
  denied: true,
  unavailable: true,
  failed: true,
} satisfies Record<HealthOutcome, true>;
const ACCESS = { allowed: true, denied: true, undetermined: true } satisfies Record<
  HealthAccess,
  true
>;
const HISTORY_ACCESS = {
  allowed: true,
  denied: true,
  undetermined: true,
  unavailable: true,
} satisfies Record<HealthHistoryAccess, true>;
// The keys each answer carries.
const ANSWER_KEYS = Object.keys({
  // `history` is Android's alone: Apple Health has no window to answer for.
  ...({ available: true, workouts: true, weighings: true } satisfies Record<
    Exclude<keyof HealthStatus, "history">,
    true
  >),
  ...({ outcomes: true } satisfies Record<"outcomes", true>),
  ...({ samples: true, anchor: true } satisfies Record<
    keyof Awaited<ReturnType<typeof health>>,
    true
  >),
  ...({ startedAt: true, kg: true } satisfies Record<keyof HealthSample, true>),
});

describe("the Apple Health requests and the iPhone app's types", () => {
  it("each object's keys are its Swift struct's fields", () => {
    const objects = everyKind();
    expect(keysOf(objects.workout)).toEqual(struct("HealthWorkout"));
    expect(keysOf(objects.workoutRemoved)).toEqual(struct("HealthWorkoutRemoved"));
    expect(keysOf(objects.weighing)).toEqual(struct("HealthWeighing"));
    expect(keysOf(objects.weighingRemoved)).toEqual(struct("HealthWeighingRemoved"));
  });

  it("the operations, scopes, kinds and outcomes are the Swift enums' cases", () => {
    expect(keysOf(OPS)).toEqual(enumCases("HealthOp"));
    expect(keysOf(SCOPES)).toEqual(enumCases("HealthScope"));
    expect(keysOf(KINDS)).toEqual(enumCases("HealthKind"));
    expect(keysOf(OUTCOMES)).toEqual(enumCases("HealthOutcome"));
  });

  it("the answers' keys are the ones Swift writes", () => {
    for (const key of ANSWER_KEYS) expect(answers).toContain(`"${key}":`);
  });

  it("the batch size is the Swift cap", () => {
    const cap = /static let maxObjects = (\d+)/.exec(body(request, "enum", "HealthRequest"));
    expect(Number(cap?.[1])).toBe(HEALTH_BATCH);
  });
});

// The same requests go to Health Connect on Android, decoded by Kotlin against the same shapes:
// the decoder lists each shape's keys and each enumeration's values as sets, read here.
const decoder = kotlin("HealthRequest.kt");
const rules = kotlin("HealthRules.kt");
const bridge = kotlin("HealthBridge.kt");
const kotlinSet = (source: string, name: string) => stringSet(source, name).sort();

describe("the Health Connect requests and the Android app's decoder", () => {
  it("each object's keys are the Kotlin decoder's", () => {
    const objects = everyKind();
    expect(keysOf(objects.workout)).toEqual(kotlinSet(decoder, "WORKOUT_KEYS"));
    expect(keysOf(objects.workoutRemoved)).toEqual(kotlinSet(decoder, "WORKOUT_REMOVED_KEYS"));
    expect(keysOf(objects.weighing)).toEqual(kotlinSet(decoder, "WEIGHING_KEYS"));
    expect(keysOf(objects.weighingRemoved)).toEqual(kotlinSet(decoder, "WEIGHING_REMOVED_KEYS"));
  });

  it("each operation's keys are the Kotlin decoder's", () => {
    const requests = {
      status: { op: "status" },
      authorize: { op: "authorize", scope: "write" },
      apply: { op: "apply", objects: [] },
      readWeighings: { op: "readWeighings", anchor: null, since: 0 },
    } satisfies { [Op in HealthRequest["op"]]: Extract<HealthRequest, { op: Op }> };
    expect(keysOf(requests.status)).toEqual(kotlinSet(decoder, "STATUS_KEYS"));
    expect(keysOf(requests.authorize)).toEqual(kotlinSet(decoder, "AUTHORIZE_KEYS"));
    expect(keysOf(requests.apply)).toEqual(kotlinSet(decoder, "APPLY_KEYS"));
    expect(keysOf(requests.readWeighings)).toEqual(kotlinSet(decoder, "READ_WEIGHINGS_KEYS"));
  });

  it("the operations, scopes, kinds, outcomes and access values are the Kotlin sets", () => {
    expect(keysOf(OPS)).toEqual(kotlinSet(decoder, "OPS"));
    expect(keysOf(SCOPES)).toEqual(kotlinSet(decoder, "SCOPES"));
    expect(keysOf(KINDS)).toEqual(kotlinSet(decoder, "KINDS"));
    expect(keysOf(OUTCOMES)).toEqual(kotlinSet(rules, "OUTCOMES"));
    expect(keysOf(ACCESS)).toEqual(kotlinSet(rules, "ACCESS"));
    expect(keysOf(HISTORY_ACCESS)).toEqual(kotlinSet(rules, "HISTORY_ACCESS"));
  });

  it("the answers' keys are the ones Kotlin writes", () => {
    for (const key of [...ANSWER_KEYS, "history"]) expect(bridge).toContain(`put("${key}",`);
  });

  it("the anchor ceiling is the same on both phones", () => {
    const swiftCeiling = /static let maxAnchor = ([\d_]+)/.exec(
      body(request, "enum", "HealthRequest"),
    );
    expect(Number(swiftCeiling?.[1]?.replaceAll("_", ""))).toBe(longConst(decoder, "MAX_ANCHOR"));
  });

  it("the batch size, the time bounds and the weight range are the page's", () => {
    expect(longConst(decoder, "MAX_OBJECTS")).toBe(HEALTH_BATCH);
    expect(longConst(decoder, "EARLIEST")).toBe(EARLIEST);
    expect(longConst(decoder, "DAY")).toBe(DAY);
    expect(longConst(decoder, "KG_MIN")).toBe(HEALTH_KG_MIN);
    expect(longConst(decoder, "KG_MAX")).toBe(HEALTH_KG_MAX);
  });
});
