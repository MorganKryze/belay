import { roundTo } from "../tools/round";

// The weekly loss range of the profile, in % of the average weight per week.
export interface TargetRange {
  minPct: number;
  maxPct: number;
}

export const DEFAULT_TARGET: TargetRange = { minPct: 0.5, maxPct: 1 };
// 0.25 to 1 % in steps of 0.05, at least 0.1 apart. Published recommendations stop at 1 %.
export const TARGET_BOUNDS = { min: 0.25, max: 1, step: 0.05, gap: 0.1 } as const;

// Checked in hundredths, so 0.85 ≤ 0.95 − 0.1 holds although 0.95 - 0.1 is 0.8499… in floats.
export function isTargetRange({ minPct, maxPct }: TargetRange): boolean {
  if (!Number.isFinite(minPct) || !Number.isFinite(maxPct)) return false;
  const [lo, hi] = [minPct * 100, maxPct * 100];
  const onGrid = (v: number) => Math.abs(v - Math.round(v)) < 1e-6 && Math.round(v) % 5 === 0;
  return (
    onGrid(lo) &&
    onGrid(hi) &&
    Math.round(lo) >= TARGET_BOUNDS.min * 100 &&
    Math.round(hi) <= TARGET_BOUNDS.max * 100 &&
    Math.round(lo) <= Math.round(hi) - TARGET_BOUNDS.gap * 100
  );
}

// Compares the loss as it is shown, to the tenth of a percent, so the "in your range" pill never
// contradicts the number next to it (the same rule as the BMI bands in the toolkit).
export function inTargetRange(lossPct: number, { minPct, maxPct }: TargetRange): boolean {
  const shown = roundTo(lossPct, 0.1);
  return shown >= minPct && shown <= maxPct;
}
