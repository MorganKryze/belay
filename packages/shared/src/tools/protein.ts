import { NAVY_RANGE_PCT } from "./body-fat";
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
  if (!(Number.isFinite(weightKg) && weightKg > 0)) {
    throw new RangeError("weight must be a positive number");
  }
  if (
    bodyFatPct !== undefined &&
    !(bodyFatPct >= NAVY_RANGE_PCT.min && bodyFatPct <= NAVY_RANGE_PCT.max)
  ) {
    throw new RangeError(`body fat must be from ${NAVY_RANGE_PCT.min} to ${NAVY_RANGE_PCT.max} %`);
  }
  let low: number;
  let high: number;
  let basis: ProteinBasis = "body-weight";
  let cutWithFloor = false;
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
    high = Math.max(high, floor);
    cutWithFloor = true;
  }
  // The floor rounds up (1e-9 absorbs 1.6 × 100 = 160.00000000000003), so the shown low end is
  // never under 1.6 g/kg.
  const floorG = Math.ceil((CUT_FLOOR_G_PER_KG * weightKg) / 5 - 1e-9) * 5;
  // Checked on the rounded value: a low end just above the floor can round down under it.
  const lowG = cutWithFloor ? Math.max(roundTo(low, 5), floorG) : roundTo(low, 5);
  const floorApplied = cutWithFloor && lowG === floorG && roundTo(low, 5) < floorG;
  const highG = Math.max(roundTo(high, 5), cutWithFloor ? floorG : 0);
  return {
    lowG,
    highG,
    basis,
    floorApplied,
    perMeal3: perMeal(lowG, highG, 3),
    perMeal4: perMeal(lowG, highG, 4),
  };
}

// Derived from the shown day range: n meals at the low end never add up to less than the day's
// low end, and n meals at the high end never to more than its high end.
function perMeal(lowG: number, highG: number, meals: number): readonly [number, number] {
  const high = Math.floor(highG / meals / 5) * 5;
  const low = Math.min(Math.ceil(lowG / meals / 5) * 5, high);
  return [low, high];
}
