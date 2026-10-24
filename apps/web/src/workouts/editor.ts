import { type ISODate, toISODate } from "@belay/shared/body/dates";
import type { Measure } from "@belay/shared/exercises/library";
import type { Change } from "@belay/shared/sync/schema";
import { countOf, type History, prefill } from "@belay/shared/training/rules";
import {
  isReps,
  isRir,
  isSeconds,
  MAX_POSITION,
  MAX_WARMUPS,
  type Slot,
  type Workout,
  type WorkoutSet,
} from "@belay/shared/training/workout";
import { parseLoad, type WeightUnit } from "@/lib/units";

// The editor of a finished session, or of one logged afterwards (spec D9, D10): every set as
// text cells, nothing written until Save, then only what changed.

export type EditRow = {
  id: string; // the set's id, or the one it will be created with
  slotIndex: number;
  position: number;
  warmup: boolean;
  exerciseId: string;
  measure: Measure;
  kg: string; // in the unit the editor was opened in
  fromKg: number | null; // the stored load the kg cell was drawn from, if any
  count: string; // reps, or seconds for a timed set
  rir: string; // empty: none
  set: WorkoutSet | null; // as stored; null for a set added here
  removed: boolean;
};

// The session's sets as rows, warm-ups first in each slot.
export function rowsOf(sets: readonly WorkoutSet[], kgText: (kg: number) => string): EditRow[] {
  return [...sets]
    .sort((a, b) => a.slotIndex - b.slotIndex || a.position - b.position)
    .map((s) => ({
      id: s.id,
      slotIndex: s.slotIndex,
      position: s.position,
      warmup: s.warmup,
      exerciseId: s.exerciseId,
      measure: s.seconds == null ? "reps" : "seconds",
      kg: kgText(s.weightKg),
      fromKg: s.weightKg,
      count: String(countOf(s)),
      rir: s.rir === null ? "" : String(s.rir),
      set: s,
      removed: false,
    }));
}

// « + Série »: a work set after the slot's last one, in the exercise the slot holds now, with
// the row before it as a start (else last time's, else nothing). Null past position 49.
export function addRow(
  rows: readonly EditRow[],
  slotIndex: number,
  slot: Slot,
  history: History,
  id: string,
  kgText: (kg: number) => string,
): EditRow | null {
  const own = rows.filter((r) => r.slotIndex === slotIndex);
  const position = Math.max(MAX_WARMUPS - 1, ...own.map((r) => r.position)) + 1;
  if (position > MAX_POSITION) return null;
  const measure: Measure = slot.measure ?? "reps";
  const before = own.filter((r) => !r.removed && !r.warmup && r.measure === measure).at(-1);
  const last = prefill(history, slot.exerciseId, position - MAX_WARMUPS, measure);
  return {
    id,
    slotIndex,
    position,
    warmup: false,
    exerciseId: slot.exerciseId,
    measure,
    kg: before?.kg ?? (last ? kgText(last.weightKg) : ""),
    fromKg: before ? before.fromKg : (last?.weightKg ?? null),
    count: before?.count ?? (last ? String(countOf(last)) : ""),
    rir: "",
    set: null,
    removed: false,
  };
}

const parseWhole = (text: string): number | null =>
  /^\s*\d+\s*$/.test(text) ? Number(text) : null;

// A row's load (typed in the unit, saved in kg), count and RIR, or null when a cell is not a valid
// value. A timed set may carry no added load (an empty cell) and has no RIR. A cell still showing
// the load it was drawn from gives that load back.
export function parseRow(
  row: EditRow,
  unit: WeightUnit = "kg",
): { weightKg: number; reps: number | null; seconds: number | null; rir: number | null } | null {
  const timed = row.measure === "seconds";
  const kg = timed && row.kg.trim() === "" ? 0 : parseLoad(row.kg, unit, row.fromKg ?? undefined);
  const count = parseWhole(row.count);
  const rir = row.rir.trim() === "" ? null : parseWhole(row.rir);
  if (kg === null || count === null) return null;
  if (timed ? !isSeconds(count) : !isReps(count)) return null;
  if (row.rir.trim() !== "" && (rir === null || !isRir(rir) || timed || row.warmup)) return null;
  return {
    weightKg: kg,
    reps: timed ? null : count,
    seconds: timed ? count : null,
    rir,
  };
}

const localNoon = (date: ISODate) =>
  new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), 12);

// A session logged afterwards starts at noon on its day; when that would end after now (today,
// in the morning), it ends now instead. Its duration is kept either way.
export function loggedTimes(
  date: ISODate,
  minutes: number,
  now: Date,
): { startedAt: string; endedAt: string } {
  const ms = minutes * 60_000;
  const end = Math.min(localNoon(date).getTime() + ms, now.getTime());
  return { startedAt: new Date(end - ms).toISOString(), endedAt: new Date(end).toISOString() };
}

// A session moved to another day keeps its time of day and its duration; one that would end
// after now ends now.
export function movedTimes(
  workout: Pick<Workout, "startedAt" | "endedAt">,
  date: ISODate,
  now: Date,
): { startedAt: string; endedAt: string } {
  const start = new Date(workout.startedAt);
  const moved = new Date(start);
  moved.setFullYear(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
  );
  const ms = Date.parse(workout.endedAt ?? workout.startedAt) - start.getTime();
  const end = Math.min(moved.getTime() + ms, now.getTime());
  return { startedAt: new Date(end - ms).toISOString(), endedAt: new Date(end).toISOString() };
}

// What Save writes: for a session logged afterwards its start, sets and end; for a finished
// one, only what changed (its day, its added exercises, each set corrected, added or removed).
// Null when a row is not valid.
export function editChanges({
  id,
  workout,
  sessionCode,
  sessionId,
  plan,
  date,
  minutes,
  rows,
  now,
  unit = "kg",
}: {
  id: string;
  workout: Workout | null; // null: a session logged afterwards
  sessionCode: string;
  sessionId?: string; // the program session a session logged afterwards comes from
  plan: Slot[];
  date: ISODate;
  minutes: number; // the duration of a session logged afterwards
  rows: readonly EditRow[];
  now: Date;
  unit?: WeightUnit; // the unit the rows were typed in
}): Change[] | null {
  const at = now.toISOString();
  const changes: Change[] = [];
  let times = workout
    ? { startedAt: workout.startedAt, endedAt: workout.endedAt ?? at }
    : loggedTimes(date, minutes, now);
  if (!workout)
    changes.push({
      kind: "workout",
      id,
      field: "start",
      sessionCode,
      ...(sessionId && { sessionId }),
      plan,
      startedAt: times.startedAt,
      at,
    });
  else {
    if (date !== toISODate(new Date(workout.startedAt))) {
      times = movedTimes(workout, date, now);
      changes.push(
        { kind: "workout", id, field: "startedAt", value: times.startedAt, at },
        { kind: "workout", id, field: "ended", value: times.endedAt, at },
      );
    }
    if (JSON.stringify(plan) !== JSON.stringify(workout.plan))
      changes.push({ kind: "workout", id, field: "plan", value: plan, at });
  }
  for (const row of rows) {
    if (row.removed) {
      if (row.set)
        changes.push({ kind: "set", id: row.id, workoutId: id, field: "removed", value: true, at });
      continue;
    }
    const value = parseRow(row, unit);
    if (!value) return null;
    if (!row.set)
      changes.push({
        kind: "set",
        id: row.id,
        workoutId: id,
        field: "create",
        slotIndex: row.slotIndex,
        position: row.position,
        exerciseId: row.exerciseId,
        warmup: false,
        ...value,
        doneAt: times.endedAt,
        at,
      });
    else if (
      value.weightKg !== row.set.weightKg ||
      value.reps !== row.set.reps ||
      value.seconds !== (row.set.seconds ?? null) ||
      value.rir !== row.set.rir
    )
      changes.push({ kind: "set", id: row.id, workoutId: id, field: "values", ...value, at });
  }
  if (!workout) changes.push({ kind: "workout", id, field: "ended", value: times.endedAt, at });
  return changes;
}
