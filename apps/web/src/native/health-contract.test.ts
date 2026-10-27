import type { SetRow, WeightRow, WorkoutRow } from "@belay/shared/sync/schema";
import { describe, expect, it } from "vitest";
import { body, cases, fields, swift } from "@/test/swift";
import {
  HEALTH_BATCH,
  HEALTH_OFF,
  health,
  type HealthObject,
  type HealthOutcome,
  type HealthRequest,
  type HealthSample,
  type HealthStatus,
  type Written,
} from "./health";
import { planHealth, sessionKey, weighingKey } from "./health-plan";

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

describe("the Apple Health requests and the iPhone app's types", () => {
  it("each object's keys are its Swift struct's fields", () => {
    const workout = planned({ workouts: [session] });
    const removed = planned(
      { workouts: [{ ...session, removed: true, removedAt: session.endedAt }] },
      { [sessionKey(ID)]: { state: "workout", version: 1, startedAt: 0, endedAt: 1 } },
    );
    const weighing = planned({ weights: [day(80)] });
    const deleted = planned(
      { weights: [day(null)] },
      { [weighingKey("2026-10-25")]: { state: "weighing", version: 1, kg: 80 } },
    );
    expect([workout.kind, removed.kind, weighing.kind, deleted.kind]).toEqual([
      "workout",
      "workoutRemoved",
      "weighing",
      "weighingRemoved",
    ]);
    expect(Object.keys(workout).sort()).toEqual(struct("HealthWorkout"));
    expect(Object.keys(removed).sort()).toEqual(struct("HealthWorkoutRemoved"));
    expect(Object.keys(weighing).sort()).toEqual(struct("HealthWeighing"));
    expect(Object.keys(deleted).sort()).toEqual(struct("HealthWeighingRemoved"));
  });

  it("the operations, scopes, kinds and outcomes are the Swift enums' cases", () => {
    // Every value of the page's own types, checked by the compiler: one added there fails to
    // compile here until it is listed, and the comparison then fails until Swift has it.
    const ops = {
      status: true,
      authorize: true,
      apply: true,
      readWeighings: true,
    } satisfies Record<HealthRequest["op"], true>;
    const scopes = { write: true, import: true } satisfies Record<
      Extract<HealthRequest, { op: "authorize" }>["scope"],
      true
    >;
    const kinds = {
      workout: true,
      workoutRemoved: true,
      weighing: true,
      weighingRemoved: true,
    } satisfies Record<HealthObject["kind"], true>;
    const outcomes = {
      written: true,
      removed: true,
      overlap: true,
      denied: true,
      unavailable: true,
      failed: true,
    } satisfies Record<HealthOutcome, true>;
    expect(Object.keys(ops).sort()).toEqual(enumCases("HealthOp"));
    expect(Object.keys(scopes).sort()).toEqual(enumCases("HealthScope"));
    expect(Object.keys(kinds).sort()).toEqual(enumCases("HealthKind"));
    expect(Object.keys(outcomes).sort()).toEqual(enumCases("HealthOutcome"));
  });

  it("the answers' keys are the ones Swift writes", () => {
    const status = { available: true, workouts: true, weighings: true } satisfies Record<
      keyof HealthStatus,
      true
    >;
    const applied = { outcomes: true } satisfies Record<"outcomes", true>;
    const read = { samples: true, anchor: true } satisfies Record<
      keyof Awaited<ReturnType<typeof health>>,
      true
    >;
    const sample = { startedAt: true, kg: true } satisfies Record<keyof HealthSample, true>;
    for (const key of Object.keys({ ...status, ...applied, ...read, ...sample })) {
      expect(answers).toContain(`"${key}":`);
    }
  });

  it("the batch size is the Swift cap", () => {
    const cap = /static let maxObjects = (\d+)/.exec(body(request, "enum", "HealthRequest"));
    expect(Number(cap?.[1])).toBe(HEALTH_BATCH);
  });
});
