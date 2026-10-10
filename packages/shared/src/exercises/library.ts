import type { Equipment, Muscle } from "./muscles";

// An exercise of the library. Its id never changes and is never reused: `ds:<dataset id>` for
// the exercises of exercises-dataset, `belay:<slug>` for the ones Belay adds.
export interface Exercise {
  id: string;
  name: string; // English, in sentence case ("Barbell bench press"), in both languages (D4)
  primary: Muscle[];
  secondary: Muscle[];
  equipment: Equipment;
  incrementKg: number;
}

// One line of data/index.json: the same fields, as a tuple to keep the file small.
export type ExerciseRow = [
  id: string,
  name: string,
  primary: Muscle[],
  secondary: Muscle[],
  equipment: Equipment,
  incrementKg: number,
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
]: ExerciseRow): Exercise => ({ id, name, primary, secondary, equipment, incrementKg });

export const toRow = (e: Exercise): ExerciseRow => [
  e.id,
  e.name,
  e.primary,
  e.secondary,
  e.equipment,
  e.incrementKg,
];

// The steps of "How to do it", by exercise id, in one language.
export type Steps = Readonly<Record<string, readonly string[]>>;
