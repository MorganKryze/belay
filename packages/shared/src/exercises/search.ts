// The library's search, as the web's Exercises screen and the phone run it: a query, a primary
// muscle and an equipment, together.
import { EXERCISES } from "./catalog";
import type { Exercise } from "./library";
import type { Equipment, Muscle } from "./muscles";

// Case, accents and word order aside: "press bench" finds "Barbell bench press".
export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
export const wordsOf = (query: string) => fold(query).split(/\s+/).filter(Boolean);
export const matches = (name: string, query: string) => {
  const target = fold(name);
  return wordsOf(query).every((w) => target.includes(w));
};

// Folded once per exercise, not once per exercise and keystroke.
const FOLDED = new Map(EXERCISES.map((e) => [e.id, fold(e.name)]));

export type Filters = { query: string; muscle: Muscle | null; equipment: Equipment | null };
export const filterExercises = (list: readonly Exercise[], f: Filters) => {
  const words = wordsOf(f.query);
  return list.filter((e) => {
    const name = FOLDED.get(e.id) ?? fold(e.name);
    return (
      words.every((w) => name.includes(w)) &&
      (f.muscle === null || e.primary.includes(f.muscle)) &&
      (f.equipment === null || e.equipment === f.equipment)
    );
  });
};
