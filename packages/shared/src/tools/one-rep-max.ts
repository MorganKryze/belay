// Epley 1985 as reproduced in Reynolds 2006 (the book has no verifiable identifier), and
// Brzycki 1993. Reynolds 2006: no more than 10 reps in these linear equations.
export const RELIABLE_MAX_REPS = 10;
export const MAX_REPS = 12;

export type OneRepMax = { epleyKg: number; brzyckiKg: number; lessReliable: boolean };

// At 1 rep the formula gives 1.033 × w; one rep IS the max, so 1RM = w.
export const epley = (weightKg: number, reps: number): number =>
  reps === 1 ? weightKg : weightKg * (1 + reps / 30);

export const brzycki = (weightKg: number, reps: number): number => (weightKg * 36) / (37 - reps);

export function oneRepMax(weightKg: number, reps: number): OneRepMax {
  if (!(Number.isFinite(weightKg) && weightKg > 0)) {
    throw new RangeError("weight must be a positive number");
  }
  if (!Number.isInteger(reps) || reps < 1 || reps > MAX_REPS) {
    throw new RangeError(`reps must be an integer from 1 to ${MAX_REPS}`);
  }
  return {
    epleyKg: epley(weightKg, reps),
    brzyckiKg: brzycki(weightKg, reps),
    lessReliable: reps > RELIABLE_MAX_REPS,
  };
}
