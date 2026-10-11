// A session as it is done, and the bounds every value keeps on the phone and the server alike
// (spec §7). Zod-free: the phone checks its entries with these before they enter its queue.
import { isExerciseId } from "../exercises/library";
import type { WarmupCount } from "../tools/warmup";

// One exercise of a session template (the data model). In a group (superset, tri-set: the same
// groupKey on consecutive slots) the rest of the group's last slot follows each round.
export interface Slot {
  exerciseId: string;
  sets: number;
  // In the exercise's measure: repetitions, or seconds for a timed exercise.
  repRange: readonly [min: number, max: number];
  rirTarget: readonly [min: number, max: number];
  restSec: number;
  warmupSets: WarmupCount;
  isMain: boolean;
  groupKey: string | null;
  // Absent on a slot counted in repetitions, like every slot of M3a's plans.
  measure?: "seconds";
  // Added by session C's rule, the week with no climbing (marked on screen).
  rule?: "no_climbing";
  // Added during the session (« + Exercice »).
  added?: true;
  // Left out for this session (« Retirer »), put back with « Remettre ».
  skipped?: boolean;
}

// A session as it was started. The plan is the copy of the day's targets: the session may change
// its own copy (an exercise replaced, a slot skipped or added), never the program.
export interface Workout {
  id: string;
  sessionCode: string;
  plan: Slot[];
  startedAt: string;
  endedAt: string | null; // null: in progress
  note: string | null;
  exerciseNotes: Record<string, string>; // by slot index
  removed: boolean;
}

// One set as it was done. Its exercise is the one really done (the data model). It counts
// repetitions or seconds, never both.
export interface WorkoutSet {
  id: string;
  workoutId: string;
  slotIndex: number;
  position: number; // warm-ups 0 to 2, work set k at MAX_WARMUPS + k
  exerciseId: string;
  warmup: boolean;
  weightKg: number; // added load for a bodyweight exercise; 0 for none
  reps: number | null; // null: a timed set
  // null, or absent on a set stored before timed sets existed: counted in repetitions.
  seconds?: number | null;
  rir: number | null; // 4 means "4 or more"
  doneAt: string;
  removed: boolean;
}

export const SET_KG = { min: 0, max: 500, step: 0.25 } as const;
export const REPS = { min: 0, max: 100 } as const;
export const SECONDS = { min: 0, max: 3600 } as const;
export const RIR_MAX = 4;
export const MAX_SETS = 150; // per session, removed ones aside
export const NOTE_MAX = 500;
export const MAX_SLOTS = 30;
export const PLAN_MAX_BYTES = 16 * 1024;
// Positions 0 to 2 are the warm-ups, so a work set keeps its position whatever their number.
export const MAX_WARMUPS = 3;
export const workPosition = (round: number) => MAX_WARMUPS + round;
// « + Série » goes past the planned sets, up to 50 positions per slot (spec D8).
export const MAX_POSITION = 49;
// The bounds of a slot of the plan (the spec leaves them to the plan); a timed slot's target is
// in seconds.
export const SLOT_BOUNDS = {
  sets: 10,
  reps: 100,
  seconds: SECONDS.max,
  restSec: 900,
  groupKey: 16,
} as const;
// A time is never before 1900; the server takes it up to 5 minutes ahead of its own clock.
export const MIN_TIME = "1900-01-01T00:00:00.000Z";
export const CLOCK_SLACK_MS = 5 * 60_000;

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

// 0 to 500 kg in steps of 0.25 (the tolerance absorbs binary noise).
export const isSetKg = (v: number) =>
  Number.isFinite(v) &&
  v >= SET_KG.min &&
  v <= SET_KG.max &&
  Math.abs(v * 4 - Math.round(v * 4)) < 1e-6;
export const isReps = (v: number) => isInt(v, REPS.min, REPS.max);
export const isSeconds = (v: number) => isInt(v, SECONDS.min, SECONDS.max);
export const isRir = (v: number | null) => v === null || isInt(v, 0, RIR_MAX);
// Counted in UTF-16 units, so never more than the database's characters.
export const isNote = (v: string) => typeof v === "string" && v.length <= NOTE_MAX;
export const isSessionCode = (v: string) => /^[A-Z]$/.test(v);

// The server's guard on a session's time: one more than 5 minutes ahead of its clock is brought
// back to it (a phone clock running ahead), never refused.
export const clampWorkoutTime = (at: string, now: Date): string =>
  Date.parse(at) > now.getTime() + CLOCK_SLACK_MS ? now.toISOString() : at;

const isRange = (v: unknown, min: number, max: number) =>
  Array.isArray(v) && v.length === 2 && isInt(v[0], min, max) && isInt(v[1], v[0], max);
const GROUP_KEY = new RegExp(`^[A-Za-z0-9]{1,${SLOT_BOUNDS.groupKey}}$`);

export function isSlot(v: unknown): v is Slot {
  const s = v as Record<string, unknown>;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.exerciseId === "string" &&
    isExerciseId(s.exerciseId) &&
    isInt(s.sets, 1, SLOT_BOUNDS.sets) &&
    (s.measure === undefined || s.measure === "seconds") &&
    isRange(s.repRange, 1, s.measure === "seconds" ? SLOT_BOUNDS.seconds : SLOT_BOUNDS.reps) &&
    isRange(s.rirTarget, 0, RIR_MAX) &&
    isInt(s.restSec, 0, SLOT_BOUNDS.restSec) &&
    isInt(s.warmupSets, 0, MAX_WARMUPS) &&
    typeof s.isMain === "boolean" &&
    (s.groupKey === null || (typeof s.groupKey === "string" && GROUP_KEY.test(s.groupKey))) &&
    (s.rule === undefined || s.rule === "no_climbing") &&
    (s.added === undefined || s.added === true) &&
    (s.skipped === undefined || typeof s.skipped === "boolean")
  );
}

// The size PostgreSQL gives the plan as text (octet_length(plan::text)): jsonb writes ": " and
// ", " where JSON.stringify writes ":" and ",".
export function planBytes(value: unknown): number {
  const separators = (v: unknown): number =>
    Array.isArray(v)
      ? Math.max(0, v.length - 1) + v.reduce((n: number, x) => n + separators(x), 0)
      : typeof v === "object" && v !== null
        ? Object.values(v).reduce(
            (n: number, x) => n + 1 + separators(x),
            Math.max(0, Object.keys(v).length - 1),
          )
        : 0;
  return new TextEncoder().encode(JSON.stringify(value)).length + separators(value);
}

export const isPlan = (v: unknown): v is Slot[] =>
  Array.isArray(v) &&
  v.length >= 1 &&
  v.length <= MAX_SLOTS &&
  v.every(isSlot) &&
  planBytes(v) <= PLAN_MAX_BYTES;

// An exercise note per slot index: "0" to "29", each 1 to 500 characters.
export const isExerciseNotes = (v: unknown): v is Record<string, string> =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.entries(v).every(
    ([k, text]) =>
      /^(0|[1-9]\d?)$/.test(k) &&
      Number(k) < MAX_SLOTS &&
      typeof text === "string" &&
      text.length >= 1 &&
      isNote(text),
  );
