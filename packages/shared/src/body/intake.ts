import { addDays, type ISODate } from "./dates";

// A day's intake: one total, never food by food. Either value may be missing (or deleted: null).
export interface IntakeLog {
  date: ISODate;
  kcal: number | null;
  proteinG: number | null;
}

// Whole numbers; the steps are the steppers' nudges, a typed 2 130 kcal is fine.
export const INTAKE_BOUNDS = {
  kcal: { min: 0, max: 10_000, step: 50 },
  protein: { min: 0, max: 500, step: 5 },
} as const;

const within = (value: number, { min, max }: { min: number; max: number }) =>
  Number.isInteger(value) && value >= min && value <= max;
export const isKcal = (value: number) => within(value, INTAKE_BOUNDS.kcal);
export const isProteinG = (value: number) => within(value, INTAKE_BOUNDS.protein);

const mean = (values: number[]) =>
  values.length === 0 ? null : values.reduce((s, v) => s + v, 0) / values.length;

// The week from Monday `weekStart`: the calorie average over the days that have one (their
// count is `days`), the protein average over the days that have protein. No threshold, no
// verdict (D6): the analysis waits for M5.
export function weeklyIntake(
  logs: readonly IntakeLog[],
  weekStart: ISODate,
): { kcalAvg: number | null; proteinAvg: number | null; days: number } {
  const end = addDays(weekStart, 6);
  const week = logs.filter((l) => l.date >= weekStart && l.date <= end);
  const kcal = week.flatMap((l) => (l.kcal === null ? [] : [l.kcal]));
  const protein = week.flatMap((l) => (l.proteinG === null ? [] : [l.proteinG]));
  return { kcalAvg: mean(kcal), proteinAvg: mean(protein), days: kcal.length };
}
