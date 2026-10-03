import { roundTo } from "./round";

export type ProteinGoal = "maintain" | "cut" | "gain";
// "lean-mass": Helms 2014, per kg of fat-free mass. "no-body-fat": Belay fallback.
export type ProteinBasis = "body-weight" | "lean-mass" | "no-body-fat";
export type ProteinRange = {
  lowG: number;
  highG: number;
  basis: ProteinBasis;
  floorApplied: boolean;
  perMeal3: readonly [number, number];
  perMeal4: readonly [number, number];
};

// Belay heuristic: when cutting, never below the maintenance point (1.6 g/kg body weight).
export const CUT_FLOOR_G_PER_KG = 1.6;

export function proteinRange(
  weightKg: number,
  goal: ProteinGoal,
  bodyFatPct?: number,
): ProteinRange {
  let low: number;
  let high: number;
  let basis: ProteinBasis = "body-weight";
  let floorApplied = false;
  if (goal === "maintain") {
    [low, high] = [1.4 * weightKg, 2.0 * weightKg]; // Jäger 2017
  } else if (goal === "gain") {
    [low, high] = [1.6 * weightKg, 2.2 * weightKg]; // Morton 2018
  } else if (bodyFatPct === undefined) {
    [low, high] = [1.8 * weightKg, 2.5 * weightKg]; // Belay heuristic: Helms at about 20 % fat
    basis = "no-body-fat";
  } else {
    const leanKg = weightKg * (1 - bodyFatPct / 100);
    [low, high] = [2.3 * leanKg, 3.1 * leanKg]; // Helms 2014, per kg of lean mass
    basis = "lean-mass";
    const floor = CUT_FLOOR_G_PER_KG * weightKg;
    if (low < floor) [low, floorApplied] = [floor, true];
    high = Math.max(high, floor);
  }
  return {
    lowG: roundTo(low, 5),
    highG: roundTo(high, 5),
    basis,
    floorApplied,
    perMeal3: [roundTo(low / 3, 5), roundTo(high / 3, 5)],
    perMeal4: [roundTo(low / 4, 5), roundTo(high / 4, 5)],
  };
}
