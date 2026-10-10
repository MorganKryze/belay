// Belay's 16 muscles: the shoulder in three heads, the back in three parts. Every exercise has one
// primary muscle and any number of secondary ones, always from this list.
export const UPPER_MUSCLES = [
  "chest",
  "front_delts",
  "side_delts",
  "rear_delts",
  "biceps",
  "triceps",
  "forearms",
  "lats",
  "upper_back",
  "lower_back",
  "abs",
] as const;
export const LOWER_MUSCLES = ["glutes", "quads", "hamstrings", "adductors", "calves"] as const;
export const MUSCLES = [...UPPER_MUSCLES, ...LOWER_MUSCLES] as const;
export type Muscle = (typeof MUSCLES)[number];
export const isMuscle = (v: unknown): v is Muscle => (MUSCLES as readonly unknown[]).includes(v);

// What the exercise is done with, and the default step between two loads (spec §5.4).
export const EQUIPMENT = [
  "barbell",
  "dumbbell",
  "machine",
  "cable",
  "bodyweight",
  "other",
] as const;
export type Equipment = (typeof EQUIPMENT)[number];
export const isEquipment = (v: unknown): v is Equipment =>
  (EQUIPMENT as readonly unknown[]).includes(v);
// Bodyweight: the load added (a belt, a vest).
export const INCREMENT_KG: Readonly<Record<Equipment, number>> = {
  barbell: 2.5,
  dumbbell: 2,
  machine: 5,
  cable: 2.5,
  bodyweight: 2.5,
  other: 1,
};
