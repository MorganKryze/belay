import type { Formula } from "./catalog";
import { roundTo } from "./round";

// FAO/WHO/UNU 2004: four values that each appear in the report (Table 5.3 and section 5.3.2).
// Not the popular 1.2 / 1.375 / 1.55 / 1.725 / 1.9, which have no traceable source.
export const PAL_LEVELS = [
  { id: "very-sedentary", pal: 1.4 },
  { id: "sedentary", pal: 1.55 },
  { id: "active", pal: 1.75 },
  { id: "very-active", pal: 2 },
] as const;
export type PalId = (typeof PAL_LEVELS)[number]["id"];

export type MifflinInput = {
  formula: Formula;
  ageYears: number;
  heightCm: number;
  weightKg: number;
};

// Mifflin-St Jeor 1990, kcal/day.
export const mifflinStJeor = ({ formula, ageYears, heightCm, weightKg }: MifflinInput): number =>
  10 * weightKg + 6.25 * heightCm - 5 * ageYears + (formula === "male" ? 5 : -161);

export type DailyEnergy = { bmrKcal: number; dayKcal: number; lowKcal: number; highKcal: number };

// Belay heuristic: Mifflin × PAL is not validated as a pair by any source. ±10 % range.
export function dailyEnergy(input: MifflinInput, pal: number): DailyEnergy {
  const bmr = mifflinStJeor(input);
  const day = bmr * pal;
  return {
    bmrKcal: roundTo(bmr, 10),
    dayKcal: roundTo(day, 10),
    lowKcal: roundTo(day * 0.9, 10),
    highKcal: roundTo(day * 1.1, 10),
  };
}
