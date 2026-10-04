import type { Band, Formula } from "./catalog";

export type NavyInput = {
  formula: Formula;
  heightCm: number;
  neckCm: number;
  waistCm: number;
  hipCm?: number;
};
export type NavyResult =
  | { kind: "ok"; percent: number; exact: number }
  | { kind: "invalid-girths" }
  | { kind: "out-of-range"; exact: number };

// Belay guard: outside this range the equation is extrapolating, so no number is shown.
export const NAVY_RANGE_PCT = { min: 2, max: 75 } as const;

// DoDI 1308.3 E3.1.3, centimetre form: the inch constants 36.76 and −78.387 become 30.295 and
// −104.912 under log10(x_in) = log10(x_cm) − log10(2.54). Rounded to an integer (E3.1.2.1).
export function navyBodyFat({ formula, heightCm, neckCm, waistCm, hipCm }: NavyInput): NavyResult {
  if (![heightCm, neckCm, waistCm, hipCm ?? 0].every(Number.isFinite)) {
    return { kind: "invalid-girths" };
  }
  const girth = formula === "male" ? waistCm - neckCm : waistCm + (hipCm ?? NaN) - neckCm;
  // log10 of zero or less is -Infinity or NaN: refuse before computing.
  if (!(girth > 0) || !(heightCm > 0)) return { kind: "invalid-girths" };
  const exact =
    formula === "male"
      ? 86.01 * Math.log10(girth) - 70.041 * Math.log10(heightCm) + 30.295
      : 163.205 * Math.log10(girth) - 97.684 * Math.log10(heightCm) - 104.912;
  // The range applies to the value that is shown: 1.7 shows as 2 and is accepted.
  const percent = Math.round(exact);
  if (percent < NAVY_RANGE_PCT.min || percent > NAVY_RANGE_PCT.max) {
    return { kind: "out-of-range", exact };
  }
  return { kind: "ok", percent, exact };
}

// Gallagher 2000: % body fat at BMI 18.5, 25 and 30. Table 4 (African American and white,
// combined) is the standard set; table 5 is the Asian set (D14).
export type BodyFatReference = "standard" | "asian";
export type AgeGroup = "20-39" | "40-59" | "60-79";
export type GallagherThresholds = { at18_5: number; at25: number; at30: number };

const t = (at18_5: number, at25: number, at30: number): GallagherThresholds => ({
  at18_5,
  at25,
  at30,
});
const GALLAGHER: Record<
  BodyFatReference,
  Record<Formula, Record<AgeGroup, GallagherThresholds>>
> = {
  standard: {
    female: { "20-39": t(21, 33, 39), "40-59": t(23, 34, 40), "60-79": t(24, 36, 42) },
    male: { "20-39": t(8, 20, 25), "40-59": t(11, 22, 28), "60-79": t(13, 25, 30) },
  },
  asian: {
    female: { "20-39": t(25, 35, 40), "40-59": t(25, 35, 41), "60-79": t(25, 36, 41) },
    male: { "20-39": t(13, 23, 28), "40-59": t(13, 24, 29), "60-79": t(14, 24, 29) },
  },
};

// Three bands only: the paper does not support interpolating between them.
export function ageGroup(ageYears: number): AgeGroup | null {
  if (!(ageYears >= 20 && ageYears < 80)) return null;
  return ageYears < 40 ? "20-39" : ageYears < 60 ? "40-59" : "60-79";
}

export function gallagherThresholds(
  formula: Formula,
  ageYears: number,
  reference: BodyFatReference,
): { group: AgeGroup; thresholds: GallagherThresholds } | null {
  const group = ageGroup(ageYears);
  return group === null ? null : { group, thresholds: GALLAGHER[reference][formula][group] };
}

// Integer percent against integer thresholds: 21–32 is the band "matching a BMI of 18.5 to 25".
export function bodyFatBand(percent: number, t: GallagherThresholds): Band {
  if (percent < t.at18_5) return "below";
  if (percent < t.at25) return "reference";
  if (percent < t.at30) return "above";
  return "well-above";
}
