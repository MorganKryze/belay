// A session's own copy of the plan (spec D6, D7): what session C adds in a week with no
// climbing, and the changes a session may make to its copy. Each returns a new plan; a slot is
// never taken out, so the sets stay attached to their slot index. The program never changes.
import type { ISODate } from "../body/dates";
import type { Measure } from "../exercises/library";
import { type Activity, climbedThisWeek } from "./activities";
import type { SessionTemplate } from "./program";
import { MAX_SLOTS, type Slot } from "./workout";

// The day's plan: the session's slots, then its no-climbing slots, marked, when no climb is
// recorded in the week of `date` (Monday to Sunday). Judged once, at the start: a session
// already started never changes when a climb is recorded later.
export function planFor(
  session: SessionTemplate,
  activities: readonly Pick<Activity, "date" | "kind" | "removed">[],
  date: ISODate,
): Slot[] {
  const extra =
    session.noClimbing && !climbedThisWeek(activities, date)
      ? session.noClimbing.map((s): Slot => ({ ...s, rule: "no_climbing" }))
      : [];
  return [...session.slots.map((s) => ({ ...s })), ...extra];
}

// The slots done today, in order: the timer, the order of rounds and the next set read these.
export const liveSlots = (plan: readonly Slot[]): number[] =>
  plan.flatMap((s, i) => (s.skipped ? [] : [i]));

// A new exercise's targets in its measure (spec §5): 8–12 reps, or 30–60 seconds.
const TARGET: Readonly<Record<Measure, readonly [number, number]>> = {
  reps: [8, 12],
  seconds: [30, 60],
};
const measureOf = (slot: Pick<Slot, "measure">): Measure => slot.measure ?? "reps";
const withMeasure = (slot: Slot, measure: Measure): Slot => {
  const out: Slot = { ...slot };
  if (measure === "seconds") out.measure = "seconds";
  else delete out.measure;
  return out;
};

// Another exercise in slot i, for this session only. Its sets, rest, RIR and group stay; the
// target goes back to the default when the measure changes, and a timed exercise has no
// warm-up. The sets already done keep their own exercise.
export function replaceSlot(
  plan: readonly Slot[],
  i: number,
  exercise: { id: string; measure: Measure },
): Slot[] {
  return plan.map((slot, j) => {
    if (j !== i) return slot;
    const same = measureOf(slot) === exercise.measure;
    return withMeasure(
      {
        ...slot,
        exerciseId: exercise.id,
        repRange: same ? slot.repRange : TARGET[exercise.measure],
        warmupSets: exercise.measure === "seconds" ? 0 : slot.warmupSets,
      },
      exercise.measure,
    );
  });
}

// Slot i left out for today, or put back (« Retirer », « Remettre »).
export const skipSlot = (plan: readonly Slot[], i: number, skipped: boolean): Slot[] =>
  plan.map((slot, j) => (j === i ? { ...slot, skipped } : slot));

// « + Exercice »: a slot at the end with the default targets (3 sets, 90 s, RIR 1–2, none to
// warm up). A plan holds 30 slots at most.
export function appendSlot(
  plan: readonly Slot[],
  exercise: { id: string; measure: Measure },
): Slot[] {
  if (plan.length >= MAX_SLOTS) throw new RangeError("a plan holds 30 slots at most");
  const slot: Slot = {
    exerciseId: exercise.id,
    sets: 3,
    repRange: TARGET[exercise.measure],
    rirTarget: [1, 2],
    restSec: 90,
    warmupSets: 0,
    isMain: false,
    groupKey: null,
    added: true,
  };
  return [...plan, withMeasure(slot, exercise.measure)];
}
