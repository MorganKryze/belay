// What a session computes from the history (spec §7). Pure; the callers pass the clock.
import type { Measure } from "../exercises/library";
import type { Equipment } from "../exercises/muscles";
import { epley, RELIABLE_MAX_REPS } from "../tools/one-rep-max";
import { roundTo } from "../tools/round";
import { WARMUP_SCHEMES, warmupSets } from "../tools/warmup";
import { liveSlots } from "./plan";
import { groupOf, plannedWorkSets } from "./program";
import { MAX_WARMUPS, type Slot, type Workout, type WorkoutSet } from "./workout";

export interface History {
  workouts: readonly Workout[];
  sets: readonly WorkoutSet[];
}
// A set's load and its count: repetitions, or seconds for a timed set (the other one null).
export type Load = { weightKg: number; reps: number | null; seconds: number | null };

// The measure a set was counted in.
export const measureOfSet = (set: Pick<WorkoutSet, "seconds">): Measure =>
  set.seconds == null ? "reps" : "seconds";
// The set's count in its own measure.
export const countOf = (set: Pick<WorkoutSet, "reps" | "seconds">): number =>
  set.seconds ?? set.reps ?? 0;
const loadOf = (set: WorkoutSet): Load => ({
  weightKg: set.weightKg,
  reps: set.reps,
  seconds: set.seconds ?? null,
});

// The sets a person sees: neither removed nor in a removed session.
export function liveSets({ workouts, sets }: History): WorkoutSet[] {
  const live = new Set(workouts.filter((w) => !w.removed).map((w) => w.id));
  return sets.filter((s) => !s.removed && live.has(s.workoutId));
}

const bySlot = (a: WorkoutSet, b: WorkoutSet) =>
  a.slotIndex - b.slotIndex || a.position - b.position;

// The work sets of an exercise at the last finished session that has some, in order; only the
// sets counted in `measure`.
function lastWorkSets(history: History, exerciseId: string, measure: Measure): WorkoutSet[] {
  const sets = liveSets(history).filter(
    (s) => !s.warmup && s.exerciseId === exerciseId && measureOfSet(s) === measure,
  );
  const finished = history.workouts
    .filter((w) => !w.removed && w.endedAt !== null && sets.some((s) => s.workoutId === w.id))
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const last = finished[0];
  return last ? sets.filter((s) => s.workoutId === last.id).sort(bySlot) : [];
}

// The same work set last time; else the last work set of that session; else nothing. The
// exercise is the one the slot holds now (a replaced one included), in its own measure.
export function prefill(
  history: History,
  exerciseId: string,
  setIndex: number,
  measure: Measure,
): Load | null {
  const sets = lastWorkSets(history, exerciseId, measure);
  const set = sets[setIndex] ?? sets.at(-1);
  return set ? loadOf(set) : null;
}

// "80 kg × 8, 8, 7, 6" or "45, 45, 40 s": last time's work sets, the counts of equal loads in a
// row grouped.
export function lastTime(
  history: History,
  exerciseId: string,
  measure: Measure,
): { weightKg: number; counts: number[] }[] {
  const groups: { weightKg: number; counts: number[] }[] = [];
  for (const s of lastWorkSets(history, exerciseId, measure)) {
    const last = groups.at(-1);
    if (last?.weightKg === s.weightKg) last.counts.push(countOf(s));
    else groups.push({ weightKg: s.weightKg, counts: [countOf(s)] });
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
      seconds: null,
    }));
  const out: Load[] = [];
  for (const [fraction, reps] of WARMUP_SCHEMES[slot.warmupSets]) {
    const weightKg = roundTo(workKg * fraction, exercise.incrementKg);
    if (weightKg <= 0 || weightKg >= workKg || out.some((s) => s.weightKg === weightKg)) continue;
    out.push({ weightKg, reps, seconds: null });
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

// A slot's group without the slots skipped today.
const liveGroup = (plan: readonly Slot[], slotIndex: number) =>
  groupOf(plan, slotIndex).filter((g) => !plan[g]!.skipped);

// The order the work sets come in: slot after slot; in a group, round after round across its
// slots (A1 B1 C1, A2 B2 C2…), a slot with fewer sets dropping out of the later rounds. A slot
// skipped today has no turn.
export function workOrder(plan: readonly Slot[]): Turn[] {
  const out: Turn[] = [];
  const seen = new Set<number>();
  for (const i of liveSlots(plan)) {
    if (seen.has(i)) continue;
    const group = liveGroup(plan, i);
    for (const g of group) seen.add(g);
    const rounds = Math.max(...group.map((g) => plan[g]!.sets));
    for (let round = 0; round < rounds; round++)
      for (const g of group) if (round < plan[g]!.sets) out.push({ slotIndex: g, round });
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

// Where an open session stands: the planned work sets done, how many are left, the last one done
// and the one up next. Warm-ups, skipped slots and « + Série » past the plan are aside.
export interface SessionProgress {
  done: ReadonlySet<string>;
  left: number;
  last: Turn | undefined;
  next: Turn | null;
}

export function sessionProgress(
  plan: readonly Slot[],
  sets: readonly WorkoutSet[],
): SessionProgress {
  const work = sets.filter((s) => {
    const slot = plan[s.slotIndex];
    return !s.warmup && slot && !slot.skipped && s.position - MAX_WARMUPS < slot.sets;
  });
  const done = new Set(work.map((s) => turnKey(turnOf(s))));
  const last = work.length
    ? turnOf([...work].sort((a, b) => (a.doneAt < b.doneAt ? -1 : 1)).at(-1)!)
    : undefined;
  return { done, left: plannedWorkSets(plan) - done.size, last, next: nextTurn(plan, done, last) };
}

// The end of the rest after a work set. Inside a group's round, none: the next exercise follows.
// After the round, or after a slot alone, the rest of the group's last slot (or the slot's own).
// A slot skipped today has no turn in the round. After the last set of the session, none.
export function restEndsAt(
  plan: readonly Slot[],
  done: ReadonlySet<string>,
  after: Turn,
  doneAt: string,
): string | null {
  const next = nextTurn(plan, done, after);
  if (next === null) return null;
  const group = liveGroup(plan, after.slotIndex);
  if (group.length > 1 && group.includes(next.slotIndex) && next.round === after.round) return null;
  // The group's rest is its last slot's, even when that slot is skipped today.
  const restSec = plan[groupOf(plan, after.slotIndex).at(-1)!]!.restSec;
  return restSec > 0 ? new Date(Date.parse(doneAt) + restSec * 1000).toISOString() : null;
}

export interface Summary {
  durationMs: number;
  workSets: number;
  warmupSets: number;
  // Σ kg × reps of the work sets counted in reps (a bodyweight set counts its added load); a
  // timed set adds nothing.
  volumeKg: number;
  records: (Load & { exerciseId: string })[];
}

// The score a record compares: the Epley estimate of a set of 1 to 10 reps, or a timed set's
// seconds; null for a set that cannot be a record.
const scoreOf = (s: WorkoutSet): number | null => {
  if (s.warmup) return null;
  if (s.seconds != null) return s.seconds > 0 ? s.seconds : null;
  return s.reps !== null && s.reps >= 1 && s.reps <= RELIABLE_MAX_REPS
    ? epley(s.weightKg, s.reps)
    : null;
};
const best = (sets: readonly WorkoutSet[], measure: Measure) =>
  sets
    .filter((s) => measureOfSet(s) === measure && scoreOf(s) !== null)
    .reduce<WorkoutSet | null>(
      (top, s) => (top === null || scoreOf(s)! > scoreOf(top)! ? s : top),
      null,
    );

// D14 and spec D11: a record is the best Epley estimate of a work set of 10 reps or fewer, or
// the longest timed set, above every earlier finished session's; never on an exercise's first
// time in that measure.
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
  const kinds = [...new Set(work.map((s) => `${s.exerciseId}|${measureOfSet(s)}`))];
  for (const kind of kinds) {
    const [exerciseId, measure] = kind.split("|") as [string, Measure];
    const now = best(
      work.filter((s) => s.exerciseId === exerciseId),
      measure,
    );
    const before = best(
      past.filter((s) => s.exerciseId === exerciseId),
      measure,
    );
    if (now && before && scoreOf(now)! > scoreOf(before)!)
      records.push({ exerciseId, ...loadOf(now) });
  }
  return {
    durationMs: workout.endedAt ? Date.parse(workout.endedAt) - Date.parse(workout.startedAt) : 0,
    workSets: work.length,
    warmupSets: own.length - work.length,
    volumeKg: work.reduce((v, s) => v + (s.reps === null ? 0 : s.weightKg * s.reps), 0),
    records,
  };
}

// The session in progress, if any: the latest one neither finished nor removed.
// With `forgotten`, a session autoClose would close is not open: it is only waiting for the
// next landed sync to be closed.
export function openWorkout<W extends Workout>(
  workouts: readonly W[],
  forgotten?: { sets: readonly WorkoutSet[]; now: Date },
): W | null {
  return workouts
    .filter(
      (w) =>
        w.endedAt === null &&
        !w.removed &&
        (!forgotten || autoClose(w, forgotten.sets, forgotten.now).kind === "keep"),
    )
    .reduce<W | null>(
      (last, w) => (last === null || w.startedAt > last.startedAt ? w : last),
      null,
    );
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
