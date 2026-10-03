import type { Band } from "./catalog";
import { roundTo } from "./round";

// WHO TRS 894, Table 2.1. Thresholds are the same at every adult age and for both sexes.
export const BMI_THRESHOLDS = { low: 18.5, reference: 25, high: 30 } as const;

// Rounded to 0.1 here, so the value shown and the band chosen are always the same number:
// a raw 24.97 shows as 25.0 and sits in 25 – 30.
export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return roundTo(weightKg / (m * m), 0.1);
}

export function bmiBand(value: number): Band {
  if (value < BMI_THRESHOLDS.low) return "below";
  if (value < BMI_THRESHOLDS.reference) return "reference";
  if (value < BMI_THRESHOLDS.high) return "above";
  return "well-above";
}

// Belay wording: suggest talking to a professional under 18.5 or from 35 (WHO class II).
export const bmiSuggestsProfessional = (value: number): boolean => value < 18.5 || value >= 35;
