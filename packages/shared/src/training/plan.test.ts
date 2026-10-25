import { describe, expect, it } from "vitest";
import {
  type Activity,
  activitySummary,
  CLIMB_GRADES,
  climbedThisWeek,
  isActivityFields,
  isActivityMinutes,
  isClimbGrade,
  isSteps,
  stepsOf,
  weekOf,
} from "./activities";
import { appendSlot, liveSlots, planFor, replaceSlot, skipSlot } from "./plan";
import { estimatedMinutes, plannedWorkSets, sessionByCode, starterProgram } from "./program";
import { lastTime, nextTurn, prefill, restEndsAt, summary, turnKey, workOrder } from "./rules";
import {
  isPlan,
  isSeconds,
  isSlot,
  MAX_SLOTS,
  type Slot,
  type Workout,
  type WorkoutSet,
  workPosition,
} from "./workout";

const A = sessionByCode("A", starterProgram)!;
const B = sessionByCode("B", starterProgram)!;
const C = sessionByCode("C", starterProgram)!;
const SQUAT = "ds:0043";
const GOBLET = "ds:1760";
const PLANK = "ds:2135";

let n = 0;
const activity = (patch: Partial<Activity> = {}): Activity => ({
  id: `a${++n}`,
  date: "2026-10-07",
  kind: "climbing",
  durationMin: 90,
  cardioType: null,
  climbStyle: "boulder",
  climbRuns: 14,
  climbGrade: "6b+",
  climbColor: null,
  removed: false,
  ...patch,
});
const workout = (patch: Partial<Workout> = {}): Workout => ({
  id: `w${++n}`,
  sessionCode: "B",
  plan: [...B.slots],
  startedAt: "2026-10-05T17:00:00.000Z",
  endedAt: "2026-10-05T18:00:00.000Z",
  note: null,
  exerciseNotes: {},
  removed: false,
  ...patch,
});
const set = (w: Workout, round: number, patch: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id: `s${++n}`,
  workoutId: w.id,
  slotIndex: 0,
  position: workPosition(round),
  exerciseId: SQUAT,
  warmup: false,
  weightKg: 100,
  reps: 8,
  seconds: null,
  rir: 2,
  doneAt: w.startedAt,
  removed: false,
  ...patch,
});
const timed = (w: Workout, round: number, seconds: number, patch: Partial<WorkoutSet> = {}) =>
  set(w, round, { exerciseId: PLANK, weightKg: 0, reps: null, seconds, rir: null, ...patch });

describe("the week (spec §5)", () => {
  it("runs from Monday to Sunday, across a new year", () => {
    expect(weekOf("2026-10-05")).toEqual({ start: "2026-10-05", end: "2026-10-11" }); // Monday
    expect(weekOf("2026-10-11")).toEqual({ start: "2026-10-05", end: "2026-10-11" }); // Sunday
    expect(weekOf("2027-01-01")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });

  it("counts a climb of the week, never a removed one, a cardio, or last week's", () => {
    expect(climbedThisWeek([activity({ date: "2026-10-11" })], "2026-10-05")).toBe(true);
    expect(climbedThisWeek([activity({ removed: true })], "2026-10-07")).toBe(false);
    expect(climbedThisWeek([activity({ kind: "cardio" })], "2026-10-07")).toBe(false);
    expect(climbedThisWeek([activity({ date: "2026-10-04" })], "2026-10-05")).toBe(false);
  });
});

describe("activities (spec §5 bounds)", () => {
  it("takes 5 to 480 minutes in steps of 5, 0 to 100 000 steps", () => {
    expect([5, 90, 480].map(isActivityMinutes)).toEqual([true, true, true]);
    expect([0, 7, 485, 4.5].map(isActivityMinutes)).toEqual([false, false, false, false]);
    expect([0, 8437, 100_000].map(isSteps)).toEqual([true, true, true]);
    expect([-1, 100_001, 10.5].map(isSteps)).toEqual([false, false, false]);
  });

  it("knows the French grades from 5a to 8c+, and no other", () => {
    expect(CLIMB_GRADES).toHaveLength(24);
    expect([CLIMB_GRADES[0], CLIMB_GRADES.at(-1)]).toEqual(["5a", "8c+"]);
    expect(["5a", "6b+", "8c+"].map(isClimbGrade)).toEqual([true, true, true]);
    expect(["4c", "9a", "5d", "6a++", "6B"].map(isClimbGrade)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("keeps cardio and climbing fields apart, a grade or a colour but not both", () => {
    const climb = {
      kind: "climbing" as const,
      durationMin: 90,
      cardioType: null,
      climbStyle: "boulder" as const,
      climbRuns: 14,
      climbGrade: "6b+",
      climbColor: null,
    };
    expect(isActivityFields(climb)).toBe(true);
    expect(isActivityFields({ ...climb, climbGrade: null, climbColor: "blue" })).toBe(true);
    expect(isActivityFields({ ...climb, climbColor: "blue" })).toBe(false);
    expect(isActivityFields({ ...climb, cardioType: "run" })).toBe(false);
    expect(isActivityFields({ ...climb, climbRuns: 201 })).toBe(false);
    const cardio = {
      ...climb,
      kind: "cardio" as const,
      cardioType: "bike" as const,
      climbStyle: null,
      climbRuns: null,
      climbGrade: null,
    };
    expect(isActivityFields(cardio)).toBe(true);
    expect(isActivityFields({ ...cardio, cardioType: null })).toBe(false);
    expect(isActivityFields({ ...cardio, climbRuns: 3 })).toBe(false);
    expect(isActivityFields({ ...cardio, durationMin: 7 })).toBe(false);
  });

  it("sums up a day: nothing, the steps, the one activity, or how many", () => {
    const steps = [{ date: "2026-10-07", steps: 8400 }];
    const climb = activity();
    expect(activitySummary([], [], "2026-10-07")).toEqual({ kind: "none" });
    expect(activitySummary([], steps, "2026-10-07")).toEqual({ kind: "steps", steps: 8400 });
    expect(activitySummary([climb], [], "2026-10-07")).toEqual({
      kind: "activity",
      activity: climb,
    });
    expect(activitySummary([climb], steps, "2026-10-07")).toEqual({ kind: "many", count: 2 });
    expect(
      activitySummary(
        [activity({ removed: true }), activity({ date: "2026-10-06" })],
        [{ date: "2026-10-07", steps: null }],
        "2026-10-07",
      ),
    ).toEqual({ kind: "none" });
    expect(stepsOf(steps, "2026-10-07")).toBe(8400);
    expect(stepsOf(steps, "2026-10-06")).toBeNull();
  });
});

describe("session C's rule (spec D6)", () => {
  it("adds the pulldown and the curl, marked, in a week with no climb", () => {
    const plan = planFor(C, [], "2026-10-07");
    expect(plan).toHaveLength(10);
    expect(plan.slice(8).map((s) => [s.exerciseId, s.rule])).toEqual([
      ["ds:2330", "no_climbing"],
      ["ds:0294", "no_climbing"],
    ]);
    expect(plan.slice(0, 8).every((s) => s.rule === undefined)).toBe(true);
    expect(isPlan(plan)).toBe(true);
    expect(estimatedMinutes({ slots: plan })).toBe(60); // 3 480 s: 58 min
  });

  it("adds nothing once a climb is recorded this week, and never to A or B", () => {
    expect(planFor(C, [activity({ date: "2026-10-05" })], "2026-10-07")).toHaveLength(8);
    expect(planFor(C, [activity({ removed: true })], "2026-10-07")).toHaveLength(10);
    expect(planFor(A, [], "2026-10-07")).toEqual(A.slots);
    expect(planFor(B, [], "2026-10-07")).toEqual(B.slots);
  });

  it("a plan keeps the first 30 slots of an overfull session", () => {
    // Two devices adding at once can leave 31 live slots: the session still starts.
    const slots = Array.from({ length: MAX_SLOTS + 1 }, (_, i) => ({
      ...A.slots[0]!,
      sets: (i % 10) + 1,
    }));
    const plan = planFor({ code: "D", slots }, [], "2026-10-07");
    expect(plan).toHaveLength(MAX_SLOTS);
    expect(plan).toEqual(slots.slice(0, MAX_SLOTS));
    expect(isPlan(plan)).toBe(true);
    const noClimbing = [{ ...A.slots[1]! }];
    expect(
      planFor({ code: "D", slots: slots.slice(0, 29), noClimbing }, [], "2026-10-07"),
    ).toHaveLength(30);
    expect(planFor({ code: "D", slots: slots.slice(0, 30), noClimbing }, [], "2026-10-07")).toEqual(
      slots.slice(0, 30),
    );
  });

  it("gives a copy: changing it never changes the program", () => {
    const plan = planFor(C, [], "2026-10-07");
    plan[0]!.sets = 9;
    expect(C.slots[0]!.sets).toBe(4);
  });
});

describe("the session's own plan (spec D7)", () => {
  const plan = planFor(C, [], "2026-10-07");

  it("replaces one slot's exercise, keeping its targets and every index", () => {
    const out = replaceSlot(B.slots, 0, { id: GOBLET, measure: "reps" });
    expect(out).toHaveLength(B.slots.length);
    expect(out[0]).toEqual({ ...B.slots[0], exerciseId: GOBLET });
    expect(out.slice(1)).toEqual(B.slots.slice(1));
    expect(B.slots[0]!.exerciseId).toBe(SQUAT);
  });

  it("gives a timed exercise its default target in seconds and no warm-up, and back", () => {
    const out = replaceSlot(B.slots, 0, { id: PLANK, measure: "seconds" });
    expect(out[0]).toMatchObject({ exerciseId: PLANK, measure: "seconds", repRange: [30, 60] });
    expect(out[0]!.warmupSets).toBe(0);
    const back = replaceSlot(out, 0, { id: SQUAT, measure: "reps" });
    expect(back[0]!.repRange).toEqual([8, 12]);
    expect("measure" in back[0]!).toBe(false);
    expect(isPlan(out) && isPlan(back)).toBe(true);
  });

  it("skips a slot for today and puts it back, never taking it out", () => {
    const skipped = skipSlot(plan, 9, true);
    expect(skipped).toHaveLength(10);
    expect(liveSlots(skipped)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plannedWorkSets(skipped)).toBe(plannedWorkSets(plan) - 2);
    expect(estimatedMinutes({ slots: skipped })).toBeLessThan(estimatedMinutes({ slots: plan }));
    expect(liveSlots(skipSlot(skipped, 9, false))).toHaveLength(10);
    expect(workOrder(skipped).some((t) => t.slotIndex === 9)).toBe(false);
  });

  it("adds a slot at the end with the default targets, 30 at most", () => {
    const out = appendSlot(A.slots, { id: GOBLET, measure: "reps" });
    expect(out.at(-1)).toEqual({
      exerciseId: GOBLET,
      sets: 3,
      repRange: [8, 12],
      rirTarget: [1, 2],
      restSec: 90,
      warmupSets: 0,
      isMain: false,
      groupKey: null,
      added: true,
    });
    expect(appendSlot(A.slots, { id: PLANK, measure: "seconds" }).at(-1)).toMatchObject({
      measure: "seconds",
      repRange: [30, 60],
    });
    const full = Array.from({ length: MAX_SLOTS }, () => A.slots[0]!);
    expect(() => appendSlot(full, { id: GOBLET, measure: "reps" })).toThrow(RangeError);
  });

  it("checks the new marks, and a timed target up to an hour", () => {
    const slot: Slot = A.slots[0]!;
    expect(isSlot({ ...slot, measure: "seconds", repRange: [30, 3600] })).toBe(true);
    expect(isSlot({ ...slot, repRange: [30, 120] })).toBe(false); // in reps, 100 at most
    expect(isSlot({ ...slot, measure: "minutes" })).toBe(false);
    expect(isSlot({ ...slot, rule: "no_climbing", added: true, skipped: false })).toBe(true);
    expect(isSlot({ ...slot, rule: "rain" })).toBe(false);
    expect(isSlot({ ...slot, added: false })).toBe(false);
    expect(isSlot({ ...slot, skipped: "yes" })).toBe(false);
    expect([0, 45, 3600].map(isSeconds)).toEqual([true, true, true]);
    expect([-1, 3601, 4.5].map(isSeconds)).toEqual([false, false, false]);
  });
});

describe("a slot skipped inside a group, and the rest", () => {
  // Session A's tri-set (slots 3, 4, 5); the calf raise (5) carries the group's 75 s.
  const done = (...keys: string[]) => new Set(keys);
  const AT = "2026-10-07T17:00:00.000Z";

  it("keeps the group's rest when its last slot is skipped", () => {
    const plan = skipSlot(A.slots, 5, true);
    // The round is lateral raise then pushdown; after the pushdown, the calf raise's 75 s.
    expect(restEndsAt(plan, done("3|0"), { slotIndex: 3, round: 0 }, AT)).toBeNull();
    expect(restEndsAt(plan, done("3|0", "4|0"), { slotIndex: 4, round: 0 }, AT)).toBe(
      "2026-10-07T17:01:15.000Z",
    );
    expect(nextTurn(plan, done("3|0", "4|0"), { slotIndex: 4, round: 0 })).toEqual({
      slotIndex: 3,
      round: 1,
    });
  });

  it("rests the group's own time when a middle slot is skipped", () => {
    const plan = skipSlot(A.slots, 4, true);
    expect(restEndsAt(plan, done("3|0"), { slotIndex: 3, round: 0 }, AT)).toBeNull();
    expect(restEndsAt(plan, done("3|0", "5|0"), { slotIndex: 5, round: 0 }, AT)).toBe(
      "2026-10-07T17:01:15.000Z",
    );
    expect(workOrder(plan).map(turnKey).slice(10, 12)).toEqual(["3|0", "5|0"]);
  });

  it("rests a skipped rule slot's neighbour as usual, and ends after the last live slot", () => {
    const plan = skipSlot(planFor(C, [], "2026-10-07"), 9, true);
    const all = new Set(workOrder(plan).map(turnKey));
    expect(restEndsAt(plan, all, { slotIndex: 8, round: 2 }, AT)).toBeNull();
  });
});

describe("timed sets and a replaced exercise (spec D11, §5)", () => {
  const last = workout();
  const history = {
    workouts: [last],
    sets: [
      set(last, 0, { exerciseId: GOBLET, weightKg: 24, reps: 10 }),
      timed(last, 0, 45),
      timed(last, 1, 45),
      timed(last, 2, 40),
    ],
  };

  it("prefills a replaced slot from its new exercise's history", () => {
    expect(prefill(history, GOBLET, 0, "reps")).toEqual({ weightKg: 24, reps: 10, seconds: null });
    expect(prefill(history, SQUAT, 0, "reps")).toBeNull();
  });

  it("prefills and recalls a timed exercise in seconds, never a set of the other measure", () => {
    expect(prefill(history, PLANK, 2, "seconds")).toEqual({ weightKg: 0, reps: null, seconds: 40 });
    expect(prefill(history, PLANK, 0, "reps")).toBeNull();
    expect(lastTime(history, PLANK, "seconds")).toEqual([{ weightKg: 0, counts: [45, 45, 40] }]);
  });

  it("adds no volume for a timed set, and finds the longest hold as a record", () => {
    const today = workout({
      startedAt: "2026-10-07T17:00:00.000Z",
      endedAt: "2026-10-07T18:00:00.000Z",
    });
    const sets = [set(today, 0), timed(today, 0, 50), timed(today, 1, 60)];
    const stats = summary(today, sets, {
      workouts: [last, today],
      sets: [...history.sets, ...sets],
    });
    expect(stats.volumeKg).toBe(800);
    expect(stats.workSets).toBe(3);
    expect(stats.records).toEqual([{ exerciseId: PLANK, weightKg: 0, reps: null, seconds: 60 }]);
  });

  it("never finds a timed record the first time, nor at an equal hold", () => {
    const first = workout({ startedAt: "2026-09-01T17:00:00.000Z" });
    const sets = [timed(first, 0, 60)];
    expect(summary(first, sets, { workouts: [first], sets }).records).toEqual([]);
    const today = workout({ startedAt: "2026-10-07T17:00:00.000Z" });
    const equal = [timed(today, 0, 45)];
    expect(
      summary(today, equal, { workouts: [last, today], sets: [...history.sets, ...equal] }).records,
    ).toEqual([]);
  });

  it("reads a set stored before timed sets existed as counted in reps", () => {
    const old: WorkoutSet = set(last, 1, { weightKg: 105 });
    delete old.seconds;
    const mixed = { workouts: [last], sets: [old] };
    expect(prefill(mixed, SQUAT, 0, "reps")).toEqual({ weightKg: 105, reps: 8, seconds: null });
  });
});
