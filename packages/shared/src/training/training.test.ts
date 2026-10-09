import { describe, expect, it } from "vitest";
import { exerciseById } from "../exercises/catalog";
import { PLATE_PRESETS } from "../tools/plates";
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
  type History,
  lastTime,
  liveSets,
  nextTurn,
  prefill,
  restEndsAt,
  summary,
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
    expect(estimatedMinutes({ code: "X", slots: [A.slots[3]!] })).toBe(5);
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
    expect(prefill(history, BENCH, 0)).toEqual({ weightKg: 80, reps: 8 });
    expect(prefill(history, BENCH, 3)).toEqual({ weightKg: 77.5, reps: 6 });
  });

  it("takes that session's last work set when it had fewer sets", () => {
    expect(prefill(history, BENCH, 5)).toEqual({ weightKg: 77.5, reps: 6 });
  });

  it("gives nothing for an exercise never done, and skips a removed session", () => {
    expect(prefill(history, "ds:0405", 0)).toBeNull();
    const removed: History = {
      workouts: [old, { ...last, removed: true }],
      sets: history.sets,
    };
    expect(prefill(removed, BENCH, 0)).toEqual({ weightKg: 77.5, reps: 8 });
  });

  it("groups equal loads in a row, warm-ups left out", () => {
    expect(lastTime(history, BENCH)).toEqual([
      { weightKg: 80, reps: [8, 8, 7] },
      { weightKg: 77.5, reps: [6] },
    ]);
    expect(lastTime(history, "ds:0405")).toEqual([]);
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

describe("warmups (D7)", () => {
  const gym = PLATE_PRESETS.gym;
  const barbell = { equipment: "barbell" as const, incrementKg: 2.5 };
  const dumbbell = { equipment: "dumbbell" as const, incrementKg: 2 };

  it("loads a barbell as the Plates tool would", () => {
    expect(warmups({ warmupSets: 2 }, 82.5, barbell, gym)).toEqual([
      { weightKg: 40, reps: 5 },
      { weightKg: 60, reps: 3 },
    ]);
  });

  it("rounds dumbbells to their step, with the same fractions and reps", () => {
    // 60 % of 22 = 13.2 → 14; 50 % of 30 = 15 → 16, 75 % → 22.5 → 22.
    expect(warmups({ warmupSets: 1 }, 22, dumbbell, gym)).toEqual([{ weightKg: 14, reps: 5 }]);
    expect(warmups({ warmupSets: 2 }, 30, dumbbell, gym)).toEqual([
      { weightKg: 16, reps: 5 },
      { weightKg: 22, reps: 3 },
    ]);
  });

  it("drops a set that rounds to the working load, to nothing, or twice to one load", () => {
    expect(warmups({ warmupSets: 1 }, 3, dumbbell, gym)).toEqual([{ weightKg: 2, reps: 5 }]);
    expect(warmups({ warmupSets: 3 }, 4, dumbbell, gym)).toEqual([{ weightKg: 2, reps: 5 }]);
    expect(warmups({ warmupSets: 1 }, 1, dumbbell, gym)).toEqual([]); // 0.6 → 0
    expect(warmups({ warmupSets: 2 }, 20, barbell, gym)).toEqual([]); // the bar alone
  });

  it("is empty without a working load, or when the slot has none", () => {
    expect(warmups({ warmupSets: 2 }, null, barbell, gym)).toEqual([]);
    expect(warmups({ warmupSets: 0 }, 100, barbell, gym)).toEqual([]);
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
      { exerciseId: BENCH, weightKg: 82.5, reps: 8 },
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
    ).toEqual([{ exerciseId: BENCH, weightKg: 72.5, reps: 10 }]);
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
