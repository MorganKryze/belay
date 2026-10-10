// The library as the app and the server read it. Importing this module loads the whole index
// (about 14 KiB gzip): the phone imports it from lazy screens only.
import index from "./data/index.json";
import { type Exercise, type ExerciseRow, toExercise } from "./library";

export const EXERCISES: readonly Exercise[] = (index as unknown as ExerciseRow[]).map(toExercise);
const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export const exerciseById = (id: string): Exercise | undefined => BY_ID.get(id);
// The server refuses a set whose exercise the library does not have.
export const isKnownExercise = (id: string): boolean => BY_ID.has(id);
