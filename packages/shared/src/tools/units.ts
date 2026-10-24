// Weights in kg or lb. Everything is stored in kg on its own grid (a set's 0.25 kg, a weigh-in's
// 0.1 kg); pounds exist only where a person types or reads a weight.
import type { Equipment } from "../exercises/muscles";
import { decimalsOf, roundTo } from "./round";

export type WeightUnit = "kg" | "lb";

// The international pound (1959), exact: no other file holds a conversion factor.
export const KG_PER_LB = 0.45359237;
export const kgToLb = (kg: number): number => kg / KG_PER_LB;
export const lbToKg = (lb: number): number => lb * KG_PER_LB;

// A set's load. lb: whole pounds, stored on the 0.25 kg grid of SET_KG. A whole pound is 0.454 kg,
// so the nearest quarter kilo is within 0.125 kg and every whole pound up to 1 102 reads back.
// Half pounds do not all survive the grid, hence the round to the whole pound first.
export const kgFromLoad = (value: number, unit: WeightUnit): number =>
  unit === "kg" ? value : roundTo(lbToKg(Math.round(value)), 0.25);
export const loadFromKg = (kg: number, unit: WeightUnit): number =>
  unit === "kg" ? kg : Math.round(kgToLb(kg));

// A weigh-in. lb: tenths of a pound, stored on the 0.1 kg grid of WEIGHING_RANGE_KG; a value read
// back is within 0.1 lb of the one typed.
export const kgFromWeighing = (value: number, unit: WeightUnit): number =>
  unit === "kg" ? value : roundTo(lbToKg(value), 0.1);
export const weighingFromKg = (kg: number, unit: WeightUnit): number =>
  unit === "kg" ? kg : roundTo(kgToLb(kg), 0.1);

// A kg step's lb counterpart, a round number of pounds near twice the step.
const LB_STEPS: readonly (readonly [kg: number, lb: number])[] = [
  [0.1, 0.1],
  [0.25, 0.5],
  [0.5, 1],
  [1, 2],
  [2.5, 5],
];
export function stepIn(stepKg: number, unit: WeightUnit): number {
  if (unit === "kg") return stepKg;
  return LB_STEPS.find(([kg]) => kg === stepKg)?.[1] ?? 10;
}

// kg bounds in the unit, rounded inward to the step so a value inside them converts back inside
// the kg bounds: ({20, 400}, lb, 0.1) → {44.1, 881.8}.
export function rangeIn(
  range: { min: number; max: number },
  unit: WeightUnit,
  step: number,
): { min: number; max: number } {
  if (unit === "kg") return { min: range.min, max: range.max };
  const scale = 10 ** decimalsOf(step);
  const steps = (lb: number) => (lb * scale) / Math.round(step * scale);
  // The epsilon keeps a bound that converts to an exact step from moving one step in.
  const min = roundTo(Math.ceil(steps(kgToLb(range.min)) - 1e-9) * step, step);
  const max = roundTo(Math.floor(steps(kgToLb(range.max)) + 1e-9) * step, step);
  return { min, max };
}

// The step between two loads in pounds, as plates and dumbbells come in a pound gym.
export const INCREMENT_LB: Readonly<Record<Equipment, number>> = {
  barbell: 5,
  dumbbell: 5,
  machine: 10,
  cable: 5,
  bodyweight: 5,
  other: 2,
};
export const incrementIn = (
  e: { equipment: Equipment; incrementKg: number },
  unit: WeightUnit,
): number => (unit === "kg" ? e.incrementKg : INCREMENT_LB[e.equipment]);
