// What a session computes from the history (spec §7). Pure; the callers pass the clock.
import type { Equipment } from "../exercises/muscles";
import { epley, RELIABLE_MAX_REPS } from "../tools/one-rep-max";
import { roundTo } from "../tools/round";
import { WARMUP_SCHEMES, warmupSets } from "../tools/warmup";
import { groupOf } from "./program";
import { MAX_WARMUPS, type Slot, type Workout, type WorkoutSet } from "./workout";

export interface History {
  workouts: readonly Workout[];
  sets: readonly WorkoutSet[];
}
export type Load = { weightKg: number; reps: number };

// The sets a person sees: neither removed nor in a removed session.
export function liveSets({ workouts, sets }: History): WorkoutSet[] {
  const live = new Set(workouts.filter((w) => !w.removed).map((w) => w.id));
  return sets.filter((s) => !s.removed && live.has(s.workoutId));
}

const bySlot = (a: WorkoutSet, b: WorkoutSet) =>
  a.slotIndex - b.slotIndex || a.position - b.position;

// The work sets of an exercise at the last finished session that has some, in order.
function lastWorkSets(history: History, exerciseId: string): WorkoutSet[] {
  const sets = liveSets(history).filter((s) => !s.warmup && s.exerciseId === exerciseId);
  const finished = history.workouts
    .filter((w) => !w.removed && w.endedAt !== null && sets.some((s) => s.workoutId === w.id))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const last = finished[0];
  return last ? sets.filter((s) => s.workoutId === last.id).sort(bySlot) : [];
}

// The same work set last time; else the last work set of that session; else nothing.
export function prefill(history: History, exerciseId: string, setIndex: number): Load | null {
  const sets = lastWorkSets(history, exerciseId);
  const set = sets[setIndex] ?? sets.at(-1);
  return set ? { weightKg: set.weightKg, reps: set.reps } : null;
}

// "80 kg × 8, 8, 7, 6": last time's work sets, the reps of equal loads in a row grouped.
export function lastTime(
  history: History,
  exerciseId: string,
): { weightKg: number; reps: number[] }[] {
  const groups: { weightKg: number; reps: number[] }[] = [];
  for (const s of lastWorkSets(history, exerciseId)) {
    const last = groups.at(-1);
    if (last?.weightKg === s.weightKg) last.reps.push(s.reps);
    else groups.push({ weightKg: s.weightKg, reps: [s.reps] });
  }
  return groups;
}

// The warm-up sets of a slot (D7). A barbell is loaded as the Plates tool says (the person's bar
// and plates); anything else takes the same fractions and reps, rounded to the exercise's step,
// never 0 or less, never the working load or more. No working load yet: no warm-up.
export function warmups(
  slot: Pick<Slot, "warmupSets">,
  workKg: number | null,
  exercise: { equipment: Equipment; incrementKg: number },
  bar: { barKg: number; platesKg: readonly number[] },
): Load[] {
  if (workKg === null || slot.warmupSets === 0) return [];
  if (exercise.equipment === "barbell")
    return warmupSets(workKg, slot.warmupSets, bar.barKg, bar.platesKg).map((s) => ({
      weightKg: s.loadKg,
      reps: s.reps,
    }));
  const out: Load[] = [];
  for (const [fraction, reps] of WARMUP_SCHEMES[slot.warmupSets]) {
    const weightKg = roundTo(workKg * fraction, exercise.incrementKg);
    if (weightKg <= 0 || weightKg >= workKg || out.some((s) => s.weightKg === weightKg)) continue;
    out.push({ weightKg, reps });
  }
  return out;
}

// A work set of the plan: its slot and its round (the k-th work set of the slot).
export type Turn = { slotIndex: number; round: number };
export const turnKey = ({ slotIndex, round }: Turn) => `${slotIndex}|${round}`;
export const turnOf = (set: Pick<WorkoutSet, "slotIndex" | "position">): Turn => ({
  slotIndex: set.slotIndex,
  round: set.position - MAX_WARMUPS,
});

// The order the work sets come in: slot after slot; in a group, round after round across its
// slots (A1 B1 C1, A2 B2 C2…), a slot with fewer sets dropping out of the later rounds.
export function workOrder(plan: readonly Slot[]): Turn[] {
  const out: Turn[] = [];
  for (let i = 0; i < plan.length;) {
    const group = groupOf(plan, i);
    const rounds = Math.max(...group.map((g) => plan[g]!.sets));
    for (let round = 0; round < rounds; round++)
      for (const g of group) if (round < plan[g]!.sets) out.push({ slotIndex: g, round });
    i = group.at(-1)! + 1;
  }
  return out;
}

// The next work set not done: after `from` in the order, else the first one left behind.
export function nextTurn(
  plan: readonly Slot[],
  done: ReadonlySet<string>,
  from?: Turn,
): Turn | null {
  const order = workOrder(plan);
  const start = from ? order.findIndex((t) => turnKey(t) === turnKey(from)) + 1 : 0;
  const open = (t: Turn) => !done.has(turnKey(t));
  return order.slice(start).find(open) ?? order.slice(0, start).find(open) ?? null;
}

// The end of the rest after a work set. Inside a group's round, none: the next exercise follows.
// After the round, or after a slot alone, the rest of the group's last slot (or the slot's own).
// After the last set of the session, none.
export function restEndsAt(
  plan: readonly Slot[],
  done: ReadonlySet<string>,
  after: Turn,
  doneAt: string,
): string | null {
  const next = nextTurn(plan, done, after);
  if (next === null) return null;
  const group = groupOf(plan, after.slotIndex);
  if (group.length > 1 && group.includes(next.slotIndex) && next.round === after.round) return null;
  const restSec = plan[group.at(-1)!]!.restSec;
  return restSec > 0 ? new Date(Date.parse(doneAt) + restSec * 1000).toISOString() : null;
}

export interface Summary {
  durationMs: number;
  workSets: number;
  warmupSets: number;
  volumeKg: number; // Σ kg × reps of the work sets (a bodyweight set counts its added load)
  records: (Load & { exerciseId: string })[];
}

const best = (sets: readonly WorkoutSet[]) =>
  sets
    .filter((s) => !s.warmup && s.reps >= 1 && s.reps <= RELIABLE_MAX_REPS)
    .reduce<WorkoutSet | null>(
      (top, s) =>
        top === null || epley(s.weightKg, s.reps) > epley(top.weightKg, top.reps) ? s : top,
      null,
    );

// D14: a record is the best Epley estimate of a work set of 10 reps or fewer, above every
// earlier finished session's; never on an exercise's first time.
export function summary(workout: Workout, sets: readonly WorkoutSet[], history: History): Summary {
  const own = sets.filter((s) => !s.removed && s.workoutId === workout.id).sort(bySlot);
  const work = own.filter((s) => !s.warmup);
  const earlier = new Set(
    history.workouts
      .filter((w) => w.id !== workout.id && !w.removed && w.endedAt !== null)
      .filter((w) => w.startedAt < workout.startedAt)
      .map((w) => w.id),
  );
  const past = liveSets(history).filter((s) => earlier.has(s.workoutId));
  const records: Summary["records"] = [];
  for (const exerciseId of [...new Set(work.map((s) => s.exerciseId))]) {
    const now = best(work.filter((s) => s.exerciseId === exerciseId));
    const before = best(past.filter((s) => s.exerciseId === exerciseId));
    if (now && before && epley(now.weightKg, now.reps) > epley(before.weightKg, before.reps))
      records.push({ exerciseId, weightKg: now.weightKg, reps: now.reps });
  }
  return {
    durationMs: workout.endedAt ? Date.parse(workout.endedAt) - Date.parse(workout.startedAt) : 0,
    workSets: work.length,
    warmupSets: own.length - work.length,
    volumeKg: work.reduce((v, s) => v + s.weightKg * s.reps, 0),
    records,
  };
}

// D12: a session left open is closed at its last set once that set is more than 6 hours old;
// one without a set is removed after 6 hours.
export const FORGOTTEN_MS = 6 * 3_600_000;
export type Closing = { kind: "keep" } | { kind: "end"; endedAt: string } | { kind: "remove" };

export function autoClose(workout: Workout, sets: readonly WorkoutSet[], now: Date): Closing {
  if (workout.endedAt !== null || workout.removed) return { kind: "keep" };
  const times = sets
    .filter((s) => !s.removed && s.workoutId === workout.id)
    .map((s) => s.doneAt)
    .sort();
  const last = times.at(-1);
  if (last === undefined)
    return now.getTime() - Date.parse(workout.startedAt) > FORGOTTEN_MS
      ? { kind: "remove" }
      : { kind: "keep" };
  return now.getTime() - Date.parse(last) > FORGOTTEN_MS
    ? { kind: "end", endedAt: last }
    : { kind: "keep" };
}
