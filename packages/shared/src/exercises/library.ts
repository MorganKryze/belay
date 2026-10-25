import type { Equipment, Muscle } from "./muscles";

// How an exercise is counted: in repetitions, or in seconds held (a plank, a hang).
export type Measure = "reps" | "seconds";

// An exercise of the library. Its id never changes and is never reused: `ds:<dataset id>` for
// the exercises of exercises-dataset, `belay:<slug>` for the ones Belay adds.
export interface Exercise {
  id: string;
  name: string; // English, in sentence case ("Barbell bench press"), in both languages
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  incrementKg: number;
  measure: Measure;
}

// One line of data/index.json: the same fields, as a tuple to keep the file small.
export type ExerciseRow = [
  id: string,
  name: string,
  primary: Muscle[],
  secondary: Muscle[],
  equipment: Equipment,
  incrementKg: number,
  measure: Measure,
];

export const EXERCISE_ID = /^(ds|belay):[a-z0-9-]{1,40}$/;
export const isExerciseId = (id: string) => EXERCISE_ID.test(id);

export const toExercise = ([
  id,
  name,
  primary,
  secondary,
  equipment,
  incrementKg,
  measure,
]: ExerciseRow): Exercise => ({ id, name, primary, secondary, equipment, incrementKg, measure });

export const toRow = (e: Exercise): ExerciseRow => [
  e.id,
  e.name,
  e.primary,
  e.secondary,
  e.equipment,
  e.incrementKg,
  e.measure,
];

// The steps of "How to do it", by exercise id, in one language.
export type Steps = Readonly<Record<string, readonly string[]>>;
