import { describe, expect, it } from "vitest";
import { exerciseById } from "../exercises/catalog";
import { MAX_TARGET_KG, PLATE_PRESETS } from "../tools/plates";
import { lbToKg, loadFromKg } from "../tools/units";
import {
  estimatedMinutes,
  groupOf,
  nextSession,
  plannedWorkSets,
  sessionByCode,
  starterProgram,
} from "./program";
import {
  autoClose,
  finishedOn,
  workSetsOf,
  type History,
  lastFinished,
  lastTime,
  liveSets,
  loggedByExercise,
  nextTurn,
  openWorkout,
  prefill,
  restEndsAt,
  restSecAfter,
  sessionProgress,
  summary,
  topSet,
  lastTopSet,
  turnKey,
  warmups,
  workOrder,
} from "./rules";
import {
  isExerciseNotes,
  isPlan,
  isReps,
  isRir,
  isSetKg,
  isSlot,
  clampWorkoutTime,
  MAX_SLOTS,
  planBytes,
  type Slot,
  type Workout,
  type WorkoutSet,
  workPosition,
} from "./workout";

const A = sessionByCode("A")!;
const B = sessionByCode("B")!;
const C = sessionByCode("C")!;
const BENCH = "ds:0025";

let n = 0;
const workout = (patch: Partial<Workout> = {}): Workout => ({
  id: `w${++n}`,
  sessionCode: "A",
  plan: [...A.slots],
  startedAt: "2026-10-05T17:00:00.000Z",
  endedAt: "2026-10-05T18:05:00.000Z",
  note: null,
  exerciseNotes: {},
  removed: false,
  ...patch,
});
const set = (
  w: Workout,
  round: number,
  weightKg: number,
  reps: number,
  patch: Partial<WorkoutSet> = {},
): WorkoutSet => ({
  id: `s${++n}`,
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
const warm = (w: Workout, position: number, weightKg: number, reps: number) =>
  set(w, 0, weightKg, reps, { position, warmup: true });

describe("the starter program (§6)", () => {
  it("names exercises the library has", () => {
    for (const s of starterProgram)
      for (const slot of s.slots)
        expect(exerciseById(slot.exerciseId), slot.exerciseId).toBeTruthy();
  });

  it("has groups of at least two consecutive slots, and only their last one rests", () => {
    for (const s of starterProgram) {
      const keys = s.slots.map((x) => x.groupKey);
      for (const [i, slot] of s.slots.entries()) {
        if (slot.groupKey === null) continue;
        const group = groupOf(s.slots, i);
        expect(group.length, `${s.code}${i}`).toBeGreaterThanOrEqual(2);
        // Consecutive: the key appears nowhere outside its run.
        expect(keys.filter((k) => k === slot.groupKey)).toHaveLength(group.length);
        if (i !== group.at(-1)) expect(slot.restSec, `${s.code}${i}`).toBe(0);
      }
    }
  });

  it("is A Push (6 slots), B Legs (7), C Glutes and pull (8), every plan within bounds", () => {
    expect(starterProgram.map((s) => [s.code, s.slots.length])).toEqual([
      ["A", 6],
      ["B", 7],
      ["C", 8],
    ]);
    for (const s of starterProgram) expect(isPlan([...s.slots]), s.code).toBe(true);
    expect(plannedWorkSets(A.slots)).toBe(19);
  });

  it("estimates the duration: every set 45 s plus its rest, to 5 minutes", () => {
    // A: 6 × 195 + 4 × 165 + 5 × 165 + 3 × 45 + 3 × 45 + 3 × 120 = 3 285 s, 54.75 min.
    expect(estimatedMinutes(A)).toBe(55);
    expect(estimatedMinutes({ slots: [A.slots[3]!] })).toBe(5);
  });
});

describe("nextSession", () => {
  it("is A with no history, then follows the last session finished, C going back to A", () => {
    expect(nextSession([])).toBe("A");
    expect(nextSession([workout({ sessionCode: "A" })])).toBe("B");
    expect(
      nextSession([
        workout({ sessionCode: "B", startedAt: "2026-10-07T17:00:00.000Z" }),
        workout({ sessionCode: "A", startedAt: "2026-10-05T17:00:00.000Z" }),
      ]),
    ).toBe("C");
    expect(nextSession([workout({ sessionCode: "C" })])).toBe("A");
  });

  it("ignores a session in progress, a removed one, and a code the program lacks", () => {
    expect(
      nextSession([
        workout({ sessionCode: "A" }),
        workout({ sessionCode: "B", startedAt: "2026-10-06T17:00:00.000Z", endedAt: null }),
        workout({ sessionCode: "C", startedAt: "2026-10-07T17:00:00.000Z", removed: true }),
      ]),
    ).toBe("B");
    expect(nextSession([workout({ sessionCode: "Z" })])).toBe("A");
  });

  // A stored program of n sessions in its own order, letters D to G included (PM9).
  const stored = (codes: string) => [...codes].map((code) => ({ code, slots: A.slots }));
  const done = (sessionCode: string) => workout({ sessionCode });

  it("the next session follows the stored order for 2 to 7 sessions", () => {
    for (const codes of ["AB", "BAC", "DACB", "ABCDE", "FEDCBA", "ABCDEFG"]) {
      const program = stored(codes);
      expect(nextSession([], program)).toBe(codes[0]);
      for (let i = 0; i < codes.length; i++) {
        expect(nextSession([done(codes[i]!)], program)).toBe(codes[(i + 1) % codes.length]);
      }
    }
  });

  it("after G comes A", () => {
    expect(nextSession([done("F")], stored("ABCDEFG"))).toBe("G");
    expect(nextSession([done("G")], stored("ABCDEFG"))).toBe("A");
  });

  it("after a session whose letter left the program comes the first", () => {
    expect(nextSession([done("B")], stored("DAC"))).toBe("D");
    expect(nextSession([done("E")], stored("ABCD"))).toBe("A");
  });
});

describe("prefill and lastTime", () => {
  const old = workout({ startedAt: "2026-09-30T17:00:00.000Z" });
  const last = workout({ startedAt: "2026-10-05T17:00:00.000Z" });
  const open = workout({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
  const history: History = {
    workouts: [old, last, open],
    sets: [
      set(old, 0, 77.5, 8),
      warm(last, 0, 40, 8),
      set(last, 0, 80, 8),
      set(last, 1, 80, 8),
      set(last, 2, 80, 7),
      set(last, 3, 77.5, 6),
      set(open, 0, 85, 5), // in progress: not "last time"
    ],
  };

  it("takes the same work set at the last finished session", () => {
    expect(prefill(history, BENCH, 0, "reps")).toEqual({ weightKg: 80, reps: 8, seconds: null });
    expect(prefill(history, BENCH, 3, "reps")).toEqual({ weightKg: 77.5, reps: 6, seconds: null });
  });

  it("takes that session's last work set when it had fewer sets", () => {
    expect(prefill(history, BENCH, 5, "reps")).toEqual({ weightKg: 77.5, reps: 6, seconds: null });
  });

  it("gives nothing for an exercise never done, and skips a removed session", () => {
    expect(prefill(history, "ds:0405", 0, "reps")).toBeNull();
    const removed: History = {
      workouts: [old, { ...last, removed: true }],
      sets: history.sets,
    };
    expect(prefill(removed, BENCH, 0, "reps")).toEqual({ weightKg: 77.5, reps: 8, seconds: null });
  });

  it("groups equal loads in a row, warm-ups left out", () => {
    expect(lastTime(history, BENCH, "reps")).toEqual([
      { weightKg: 80, counts: [8, 8, 7] },
      { weightKg: 77.5, counts: [6] },
    ]);
    expect(lastTime(history, "ds:0405", "reps")).toEqual([]);
  });

  it("never counts a set of a removed session, nor a removed set", () => {
    const w = workout({ removed: true });
    const kept = workout();
    expect(
      liveSets({
        workouts: [w, kept],
        sets: [set(w, 0, 80, 8), set(kept, 0, 80, 8, { removed: true }), set(kept, 1, 82.5, 8)],
      }).map((s) => s.weightKg),
    ).toEqual([82.5]);
  });
});

describe("loggedByExercise", () => {
  const w = workout();
  it("lists the exercises in plan order, each with its work sets and its top set", () => {
    const sets = [
      set(w, 0, 10, 15, { slotIndex: 4, exerciseId: "ds:0334" }),
      set(w, 0, 80, 8),
      set(w, 1, 80, 7),
    ];
    expect(loggedByExercise(w, sets)).toEqual([
      {
        slotIndex: 0,
        exerciseId: BENCH,
        workSets: 2,
        top: { weightKg: 80, reps: 8, seconds: null },
      },
      {
        slotIndex: 4,
        exerciseId: "ds:0334",
        workSets: 1,
        top: { weightKg: 10, reps: 15, seconds: null },
      },
    ]);
  });

  it("leaves out warm-ups, removed sets and a slot with no work set", () => {
    const sets = [
      warm(w, 0, 40, 8),
      set(w, 0, 60, 8, { removed: true }),
      set(w, 0, 70, 6, { slotIndex: 1 }),
      warm(w, 1, 50, 5),
      { ...warm(w, 0, 30, 5), slotIndex: 2 },
    ];
    expect(loggedByExercise(w, sets)).toEqual([
      {
        slotIndex: 1,
        exerciseId: BENCH,
        workSets: 1,
        top: { weightKg: 70, reps: 6, seconds: null },
      },
    ]);
  });

  it("lists a replaced exercise under the exercise really done, and only this session's sets", () => {
    const other = workout();
    const sets = [set(w, 0, 30, 10, { exerciseId: "ds:0405" }), set(other, 0, 90, 5)];
    expect(loggedByExercise(w, sets)).toEqual([
      {
        slotIndex: 0,
        exerciseId: "ds:0405",
        workSets: 1,
        top: { weightKg: 30, reps: 10, seconds: null },
      },
    ]);
  });
});

describe("topSet", () => {
  const w = workout();
  it("the heaviest load wins, then the most reps", () => {
    expect(topSet([set(w, 0, 80, 7), set(w, 1, 80, 8), set(w, 2, 77.5, 10)])).toEqual({
      weightKg: 80,
      reps: 8,
      seconds: null,
    });
  });

  it("a timed set: the longest hold, then the heaviest", () => {
    const hold = (round: number, weightKg: number, seconds: number) =>
      set(w, round, weightKg, 0, { reps: null, seconds });
    expect(topSet([hold(0, 10, 40), hold(1, 0, 45), hold(2, 5, 45)])).toEqual({
      weightKg: 5,
      reps: null,
      seconds: 45,
    });
  });

  it("none gives null, and a warm-up is never the top set", () => {
    expect(topSet([])).toBeNull();
    expect(topSet([set(w, 0, 100, 5, { warmup: true, position: 0 })])).toBeNull();
  });

  it("lastTopSet reads the last finished session that did the exercise", () => {
    const older = workout({ startedAt: "2026-09-30T17:00:00.000Z" });
    const newer = workout({ startedAt: "2026-10-05T17:00:00.000Z" });
    const open = workout({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
    const history: History = {
      workouts: [older, newer, open],
      sets: [
        set(older, 0, 90, 6),
        set(newer, 0, 80, 7),
        set(newer, 1, 80, 8),
        set(open, 0, 100, 5),
      ],
    };
    expect(lastTopSet(history, BENCH, "reps")).toEqual({ weightKg: 80, reps: 8, seconds: null });
    expect(lastTopSet(history, BENCH, "seconds")).toBeNull();
    expect(lastTopSet(history, "ds:0405", "reps")).toBeNull();
  });
});

describe("warmups (D7)", () => {
  const gym = PLATE_PRESETS.gym;
  const barbell = { equipment: "barbell" as const, incrementKg: 2.5 };
  const dumbbell = { equipment: "dumbbell" as const, incrementKg: 2 };

  it("loads a barbell as the Plates tool would", () => {
    expect(warmups({ warmupSets: 2 }, 82.5, barbell, gym)).toEqual([
      { weightKg: 40, reps: 5, seconds: null },
      { weightKg: 60, reps: 3, seconds: null },
    ]);
  });

  it("rounds dumbbells to their step, with the same fractions and reps", () => {
    // 60 % of 22 = 13.2 → 14; 50 % of 30 = 15 → 16, 75 % → 22.5 → 22.
    expect(warmups({ warmupSets: 1 }, 22, dumbbell, gym)).toEqual([
      { weightKg: 14, reps: 5, seconds: null },
    ]);
    expect(warmups({ warmupSets: 2 }, 30, dumbbell, gym)).toEqual([
      { weightKg: 16, reps: 5, seconds: null },
      { weightKg: 22, reps: 3, seconds: null },
    ]);
  });

  it("drops a set that rounds to the working load, to nothing, or twice to one load", () => {
    const two = [{ weightKg: 2, reps: 5, seconds: null }];
    expect(warmups({ warmupSets: 1 }, 3, dumbbell, gym)).toEqual(two);
    expect(warmups({ warmupSets: 3 }, 4, dumbbell, gym)).toEqual(two);
    expect(warmups({ warmupSets: 1 }, 1, dumbbell, gym)).toEqual([]); // 0.6 → 0
    expect(warmups({ warmupSets: 2 }, 20, barbell, gym)).toEqual([]); // the bar alone
  });

  it("is empty without a working load, or when the slot has none", () => {
    expect(warmups({ warmupSets: 2 }, null, barbell, gym)).toEqual([]);
    expect(warmups({ warmupSets: 0 }, 100, barbell, gym)).toEqual([]);
  });

  it("is empty for a load the plate table cannot reach, instead of throwing", () => {
    expect(warmups({ warmupSets: 2 }, 8000, barbell, gym)).toEqual([]);
    expect(warmups({ warmupSets: 2 }, Number.POSITIVE_INFINITY, barbell, gym)).toEqual([]);
    expect(warmups({ warmupSets: 2 }, Number.NaN, barbell, gym)).toEqual([]);
  });

  it("lb warm-ups of a 225 lb barbell set come from the lb set", () => {
    // 225 lb is 102.06 kg, stored as 102 kg; the kg set would give 40, 60 and 80 kg.
    const sets = warmups({ warmupSets: 3 }, 102, barbell, gym, "lb");
    expect(sets.map((s) => loadFromKg(s.weightKg, "lb"))).toEqual([90, 135, 180]);
    expect(sets.map((s) => s.reps)).toEqual([5, 3, 1]);
    for (const s of sets) expect(isSetKg(s.weightKg)).toBe(true);
    expect(warmups({ warmupSets: 3 }, 102, barbell, gym)).toEqual([
      { weightKg: 40, reps: 5, seconds: null },
      { weightKg: 60, reps: 3, seconds: null },
      { weightKg: 80, reps: 1, seconds: null },
    ]);
  });

  it("lb warm-ups of a dumbbell round to 5 lb", () => {
    // 60 lb work: 50 % → 30 lb, 75 % → 45 lb.
    const sets = warmups({ warmupSets: 2 }, 27.25, dumbbell, gym, "lb");
    expect(sets.map((s) => loadFromKg(s.weightKg, "lb"))).toEqual([30, 45]);
    for (const s of sets) expect(isSetKg(s.weightKg)).toBe(true);
    // 10 lb work: 60 % → 6 lb → 5 lb; a set rounding to the work load or to nothing is dropped.
    expect(warmups({ warmupSets: 1 }, 4.5, dumbbell, gym, "lb").map((s) => s.weightKg)).toEqual([
      2.25,
    ]);
    expect(warmups({ warmupSets: 1 }, 1, dumbbell, gym, "lb")).toEqual([]);
  });

  it("lb warm-ups reach the top of the set grid as kg ones do", () => {
    // 454 kg is 1 001 lb: past 1 000 units, still a valid set.
    const sets = warmups({ warmupSets: 3 }, 454, barbell, gym, "lb");
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) expect(isSetKg(s.weightKg)).toBe(true);
    expect(warmups({ warmupSets: 3 }, 500, barbell, gym, "lb").length).toBeGreaterThan(0);
  });

  it("lb warm-ups keep the 1 000 kg guard", () => {
    expect(warmups({ warmupSets: 2 }, MAX_TARGET_KG + 0.25, barbell, gym, "lb")).toEqual([]);
    expect(warmups({ warmupSets: 2 }, 8000, dumbbell, gym, "lb")).toEqual([]);
    expect(warmups({ warmupSets: 2 }, Number.NaN, barbell, gym, "lb")).toEqual([]);
    expect(warmups({ warmupSets: 2 }, null, barbell, gym, "lb")).toEqual([]);
    expect(warmups({ warmupSets: 0 }, 100, barbell, gym, "lb")).toEqual([]);
    // Past the plate table's 1 000 units, but under 1 000 kg: no warm-up, never a throw.
    expect(warmups({ warmupSets: 3 }, lbToKg(1400), barbell, gym, "lb")).toEqual([]);
  });
});

describe("the order of work sets and the rest (§4.3)", () => {
  const done = (...keys: string[]) => new Set(keys);

  it("goes slot after slot, and round after round inside a group", () => {
    const order = workOrder(C.slots).map(turnKey);
    expect(order.slice(10, 17)).toEqual(["3|0", "4|0", "5|0", "3|1", "4|1", "5|1", "5|2"]);
    expect(order).toHaveLength(plannedWorkSets(C.slots));
  });

  it("rests the slot's own time after a slot alone", () => {
    expect(
      restEndsAt(A.slots, done("0|0"), { slotIndex: 0, round: 0 }, "2026-10-07T17:00:00.000Z"),
    ).toBe("2026-10-07T17:02:30.000Z");
  });

  it("plans the rest a set starts: its slot's own, or its group's last slot's", () => {
    expect(restSecAfter(A.slots, 0)).toBe(150);
    expect(restSecAfter(A.slots, 3)).toBe(75);
    expect(restSecAfter(A.slots, 5)).toBe(75);
  });

  it("does not rest between two exercises of a round", () => {
    const after = { slotIndex: 3, round: 0 };
    expect(restEndsAt(A.slots, done("3|0"), after, "2026-10-07T17:00:00.000Z")).toBeNull();
  });

  it("rests the group's last slot after the round", () => {
    const after = { slotIndex: 5, round: 0 };
    expect(restEndsAt(A.slots, done("3|0", "4|0", "5|0"), after, "2026-10-07T17:00:00.000Z")).toBe(
      "2026-10-07T17:01:15.000Z",
    );
  });

  it("rests when the round's last exercise is skipped and the next round starts", () => {
    // Push-up and face pull of round 1 done, lateral raise skipped: the next undone set of the
    // round is that lateral raise, so no rest; once it is left behind, round 2 starts after a rest.
    const after = { slotIndex: 4, round: 0 };
    expect(restEndsAt(C.slots, done("3|0", "4|0"), after, "2026-10-07T17:00:00.000Z")).toBeNull();
    const skipped = { slotIndex: 4, round: 1 };
    expect(nextTurn(C.slots, done("3|0", "4|0", "3|1", "4|1"), skipped)).toEqual({
      slotIndex: 5,
      round: 1,
    });
    expect(
      restEndsAt(
        C.slots,
        done("3|0", "4|0", "5|1", "3|1", "4|1"),
        { slotIndex: 5, round: 1 },
        "2026-10-07T17:00:00.000Z",
      ),
    ).toBe("2026-10-07T17:01:00.000Z");
  });

  it("does not rest after the last set of the session", () => {
    const all = new Set(workOrder(A.slots).map(turnKey));
    expect(
      restEndsAt(A.slots, all, { slotIndex: 5, round: 2 }, "2026-10-07T17:00:00.000Z"),
    ).toBeNull();
  });

  it("goes back to a set left behind once the order is done", () => {
    const all = workOrder(B.slots)
      .map(turnKey)
      .filter((k) => k !== "0|1");
    expect(nextTurn(B.slots, new Set(all), { slotIndex: 6, round: 2 })).toEqual({
      slotIndex: 0,
      round: 1,
    });
  });
});

describe("sessionProgress", () => {
  const open = () => workout({ endedAt: null });

  it("sessionProgress: nothing done puts the first turn up next", () => {
    const p = sessionProgress(A.slots, []);
    expect(p.done.size).toBe(0);
    expect(p.left).toBe(plannedWorkSets(A.slots));
    expect(p.last).toBeUndefined();
    expect(p.next).toEqual({ slotIndex: 0, round: 0 });
  });

  it("after a set, the next turn in the order comes up and is the last done", () => {
    const w = open();
    const sets = [
      set(w, 0, 60, 8, { doneAt: "2026-10-05T17:05:00.000Z" }),
      set(w, 1, 60, 8, { doneAt: "2026-10-05T17:08:00.000Z" }),
      warm(w, 0, 20, 10),
    ];
    const p = sessionProgress(A.slots, sets);
    expect([...p.done]).toEqual(["0|0", "0|1"]);
    expect(p.left).toBe(plannedWorkSets(A.slots) - 2);
    expect(p.last).toEqual({ slotIndex: 0, round: 1 });
    expect(p.next).toEqual({ slotIndex: 0, round: 2 });
  });

  it("skipped slots and sets past the plan do not count", () => {
    const w = open();
    const plan = A.slots.map((s, i) => (i === 1 ? { ...s, skipped: true } : s));
    const sets = [
      set(w, 0, 60, 8, { slotIndex: 1 }),
      set(w, A.slots[0]!.sets, 60, 8, { slotIndex: 0 }),
    ];
    const p = sessionProgress(plan, sets);
    expect(p.done.size).toBe(0);
    expect(p.left).toBe(plannedWorkSets(plan));
    expect(p.last).toBeUndefined();
  });

  it("every set done leaves nothing up next", () => {
    const w = open();
    const sets = workOrder(A.slots).map((t) => set(w, t.round, 60, 8, { slotIndex: t.slotIndex }));
    const p = sessionProgress(A.slots, sets);
    expect(p.left).toBe(0);
    expect(p.next).toBeNull();
  });
});

describe("summary (§4.4, D14)", () => {
  const before = workout({ startedAt: "2026-10-05T17:00:00.000Z" });
  const today = workout({
    startedAt: "2026-10-07T17:00:00.000Z",
    endedAt: "2026-10-07T18:04:00.000Z",
  });
  const pushups = { slotIndex: 1, exerciseId: "ds:0662" };

  it("counts work sets and volume, warm-ups apart, a bodyweight set by its added load", () => {
    const sets = [
      warm(today, 0, 40, 8),
      warm(today, 1, 60, 5),
      set(today, 0, 82.5, 8),
      set(today, 1, 82.5, 8),
      set(today, 0, 0, 12, pushups),
      set(today, 1, 10, 8, pushups),
      set(today, 2, 100, 1, { removed: true }),
    ];
    expect(summary(today, sets, { workouts: [today], sets })).toEqual({
      durationMs: 64 * 60_000,
      workSets: 4,
      warmupSets: 2,
      volumeKg: 82.5 * 16 + 80,
      records: [],
    });
  });

  it("finds a record only above the best earlier estimate, never the first time", () => {
    const past = [set(before, 0, 80, 8), set(before, 1, 80, 9, { exerciseId: "ds:0405" })];
    const sets = [set(today, 0, 82.5, 8), set(today, 1, 85, 3), set(today, 0, 20, 10, pushups)];
    const history = { workouts: [before, today], sets: [...past, ...sets] };
    // 82.5 × 8 → 104.5 beats 80 × 8 → 101.3; 85 × 3 → 93.5 does not. Push-ups: a first time.
    expect(summary(today, sets, history).records).toEqual([
      { exerciseId: BENCH, weightKg: 82.5, reps: 8, seconds: null },
    ]);
    const equal = [set(today, 0, 80, 8)];
    expect(
      summary(today, equal, { workouts: [before, today], sets: [...past, ...equal] }).records,
    ).toEqual([]);
  });

  it("ignores sets above 10 reps, today and before", () => {
    const past = [set(before, 0, 60, 15), set(before, 1, 70, 10)];
    const sets = [set(today, 0, 65, 15), set(today, 1, 70, 10)];
    expect(
      summary(today, sets, { workouts: [before, today], sets: [...past, ...sets] }).records,
    ).toEqual([]);
    const better = [set(today, 0, 72.5, 10)];
    expect(
      summary(today, better, { workouts: [before, today], sets: [...past, ...better] }).records,
    ).toEqual([{ exerciseId: BENCH, weightKg: 72.5, reps: 10, seconds: null }]);
  });

  it("counts a session that ends after midnight on its own duration", () => {
    const late = workout({
      startedAt: "2026-10-07T21:30:00.000Z",
      endedAt: "2026-10-07T22:40:00.000Z",
    });
    expect(summary(late, [], { workouts: [late], sets: [] }).durationMs).toBe(70 * 60_000);
  });
});

describe("autoClose (D12)", () => {
  const open = workout({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
  const last = "2026-10-07T18:00:00.000Z";
  const sets = [
    set(open, 0, 80, 8, { doneAt: "2026-10-07T17:30:00.000Z" }),
    set(open, 1, 80, 8, { doneAt: last }),
  ];
  const at = (iso: string) => new Date(iso);

  it("keeps a session whose last set is 5 h 59 old, ends one 6 h 01 old at that set", () => {
    expect(autoClose(open, sets, at("2026-10-07T23:59:00.000Z"))).toEqual({ kind: "keep" });
    expect(autoClose(open, sets, at("2026-10-08T00:01:00.000Z"))).toEqual({
      kind: "end",
      endedAt: last,
    });
  });

  it("keeps a session going on past midnight while its sets keep coming", () => {
    const night = [set(open, 0, 80, 8, { doneAt: "2026-10-07T22:50:00.000Z" })];
    expect(autoClose(open, night, at("2026-10-07T23:10:00.000Z"))).toEqual({ kind: "keep" });
  });

  it("removes a session without a set after 6 hours, and leaves a finished one alone", () => {
    expect(autoClose(open, [], at("2026-10-07T22:59:00.000Z"))).toEqual({ kind: "keep" });
    expect(autoClose(open, [], at("2026-10-07T23:01:00.000Z"))).toEqual({ kind: "remove" });
    expect(autoClose(workout(), [], at("2026-12-01T00:00:00.000Z"))).toEqual({ kind: "keep" });
  });

  it("ignores a removed set", () => {
    const gone = [set(open, 0, 80, 8, { doneAt: last, removed: true })];
    expect(autoClose(open, gone, at("2026-10-07T23:01:00.000Z"))).toEqual({ kind: "remove" });
  });

  // Paused at 18:05 after the last set, resumed at 18:35 with no set after it: the start moved
  // from 17:00 to 17:30, written at 18:35.
  const resumed = { ...open, startedAt: "2026-10-07T17:30:00.000Z" };
  const resumeAt = "2026-10-07T18:35:00.000Z";

  it("ends a session resumed after its last set at the resume, 6 hours after it", () => {
    const w = { ...resumed, startedAtAt: resumeAt };
    expect(autoClose(w, sets, at("2026-10-08T00:01:00.000Z"))).toEqual({ kind: "keep" });
    const closing = autoClose(w, sets, at("2026-10-08T00:36:00.000Z"));
    expect(closing).toEqual({ kind: "end", endedAt: resumeAt });
    // The time it records is the time the session's clock showed at the resume.
    const ended = { ...w, endedAt: resumeAt };
    expect(summary(ended, sets, { workouts: [ended], sets }).durationMs).toBe(65 * 60_000);
  });

  it("never ends a resumed session before its moved start, however long the pause", () => {
    // Paused at 18:05, resumed at 20:00: the start moved to 18:55, after the last set.
    const late = "2026-10-07T20:00:00.000Z";
    const w = { ...open, startedAt: "2026-10-07T18:55:00.000Z", startedAtAt: late };
    expect(autoClose(w, sets, at("2026-10-08T02:01:00.000Z"))).toEqual({
      kind: "end",
      endedAt: late,
    });
  });

  it("still ends at the last set when the start moved before it", () => {
    const w = { ...resumed, startedAtAt: "2026-10-07T17:45:00.000Z" };
    expect(autoClose(w, sets, at("2026-10-08T00:01:00.000Z"))).toEqual({
      kind: "end",
      endedAt: last,
    });
  });
});

describe("lastFinished", () => {
  it("is the latest ended session of the code, the open, removed and other ones left out", () => {
    const early = workout({ startedAt: "2026-10-01T17:00:00.000Z" });
    const late = workout({ startedAt: "2026-10-05T17:00:00.000Z" });
    const workouts = [
      late,
      early,
      workout({ startedAt: "2026-10-06T17:00:00.000Z", endedAt: null }),
      workout({ startedAt: "2026-10-07T17:00:00.000Z", removed: true }),
      workout({ startedAt: "2026-10-08T17:00:00.000Z", sessionCode: "B" }),
    ];
    expect(lastFinished(workouts, "A")).toBe(late);
    expect(lastFinished([early, late], "A")).toBe(late);
  });

  it("is null when no session of the code ended", () => {
    expect(lastFinished([], "A")).toBeNull();
    expect(lastFinished([workout({ endedAt: null }), workout({ removed: true })], "A")).toBeNull();
    expect(lastFinished([workout()], "B")).toBeNull();
  });
});

describe("finishedOn", () => {
  // Times on this device's clock: the day is the one the session started on here.
  const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).toISOString();
  const history = (workouts: Workout[], sets: WorkoutSet[] = []): History => ({ workouts, sets });

  it("the session started today and ended", () => {
    const today = workout({ startedAt: at(7, 18), endedAt: at(7, 19) });
    expect(finishedOn(history([workout(), today]), "2026-10-07")?.workout).toBe(today);
  });

  it("removed, still open or started yesterday and ended today: none", () => {
    const workouts = [
      workout({ startedAt: at(7, 6), endedAt: at(7, 7), removed: true }),
      workout({ startedAt: at(7, 8), endedAt: null }),
      workout({ startedAt: at(6, 23, 30), endedAt: at(7, 0, 30) }),
    ];
    expect(finishedOn(history(workouts), "2026-10-07")).toBeNull();
    expect(finishedOn(history([]), "2026-10-07")).toBeNull();
  });

  it("two today: the one started last", () => {
    const morning = workout({ startedAt: at(7, 7), endedAt: at(7, 8) });
    const evening = workout({ startedAt: at(7, 18), endedAt: at(7, 19) });
    expect(finishedOn(history([evening, morning]), "2026-10-07")?.workout).toBe(evening);
  });

  it("length and work sets, warm-ups left out", () => {
    const w = workout({ startedAt: at(7, 18), endedAt: at(7, 18, 48) });
    const sets = [
      warm(w, 0, 40, 8),
      set(w, 1, 60, 8),
      set(w, 2, 60, 8),
      set(w, 3, 60, 8, { removed: true }),
      set(workout(), 1, 60, 8),
    ];
    const done = finishedOn(history([w], sets), "2026-10-07");
    expect(done?.durationMs).toBe(48 * 60_000);
    expect(done?.workSets).toBe(2);
  });
});

describe("workSetsOf", () => {
  it("counts a session's kept work sets, warm-ups left out", () => {
    const w = workout();
    const sets = [
      warm(w, 0, 40, 8),
      set(w, 1, 60, 8),
      set(w, 2, 60, 8),
      set(w, 3, 60, 8, { removed: true }),
      set(workout(), 1, 60, 8),
    ];
    expect(workSetsOf({ workouts: [w], sets }, w.id)).toBe(2);
    expect(workSetsOf({ workouts: [w], sets: [] }, w.id)).toBe(0);
  });
});

describe("openWorkout", () => {
  it("is the latest session neither finished nor removed, if any", () => {
    const older = workout({ startedAt: "2026-10-06T17:00:00.000Z", endedAt: null });
    const newer = workout({ startedAt: "2026-10-07T17:00:00.000Z", endedAt: null });
    const removed = workout({
      startedAt: "2026-10-08T17:00:00.000Z",
      endedAt: null,
      removed: true,
    });
    expect(openWorkout([older, newer, removed, workout()])).toBe(newer);
    expect(openWorkout([workout()])).toBeNull();
  });
});

describe("bounds (§7)", () => {
  it("takes loads from 0 to 500 kg in steps of 0.25", () => {
    expect([0, 0.25, 82.5, 101.75, 500].map(isSetKg)).toEqual([true, true, true, true, true]);
    expect([-0.25, 500.25, 80.1, Number.NaN].map(isSetKg)).toEqual([false, false, false, false]);
  });

  it("takes whole reps from 0 to 100, and a RIR from 0 to 4 or none", () => {
    expect([0, 12, 100].map(isReps)).toEqual([true, true, true]);
    expect([-1, 101, 8.5].map(isReps)).toEqual([false, false, false]);
    expect([null, 0, 4].map(isRir)).toEqual([true, true, true]);
    expect([5, -1, 1.5].map(isRir)).toEqual([false, false, false]);
  });

  it("brings a time more than 5 minutes ahead back to the clock", () => {
    const now = new Date("2026-10-07T17:00:00.000Z");
    expect(clampWorkoutTime("2026-10-07T17:05:00.000Z", now)).toBe("2026-10-07T17:05:00.000Z");
    expect(clampWorkoutTime("2026-10-07T17:05:01.000Z", now)).toBe("2026-10-07T17:00:00.000Z");
  });

  it("checks a plan: 1 to 30 valid slots, 16 KiB at most as PostgreSQL writes it", () => {
    const slot: Slot = A.slots[0]!;
    expect(isSlot({ ...slot, sets: 0 })).toBe(false);
    expect(isSlot({ ...slot, repRange: [8, 6] })).toBe(false);
    expect(isSlot({ ...slot, rirTarget: [0, 5] })).toBe(false);
    expect(isSlot({ ...slot, exerciseId: "bench" })).toBe(false);
    expect(isSlot({ ...slot, groupKey: "a b" })).toBe(false);
    expect(isPlan([])).toBe(false);
    expect(isPlan(Array.from({ length: MAX_SLOTS }, () => slot))).toBe(true);
    expect(isPlan(Array.from({ length: MAX_SLOTS + 1 }, () => slot))).toBe(false);
    expect(planBytes({ a: [1, 2], b: "é" })).toBe(`{"a": [1, 2], "b": "é"}`.length + 1);
  });

  it("checks exercise notes: by slot index, 1 to 500 characters", () => {
    expect(isExerciseNotes({ "0": "Prise large", "29": "x".repeat(500) })).toBe(true);
    expect(isExerciseNotes({ "30": "x" })).toBe(false);
    expect(isExerciseNotes({ "01": "x" })).toBe(false);
    expect(isExerciseNotes({ "0": "" })).toBe(false);
    expect(isExerciseNotes({ "0": "x".repeat(501) })).toBe(false);
    expect(isExerciseNotes([])).toBe(false);
  });
});
