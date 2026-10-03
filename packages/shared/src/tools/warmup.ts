import { nearestLoading } from "./plates";

// Belay heuristic: no study validates a warm-up scheme (Ribeiro 2020 is the closest evidence).
export type WarmupCount = 0 | 1 | 2 | 3;
export type WarmupSet = { loadKg: number; reps: number; perSideKg: number[] };

const SCHEMES: Record<1 | 2 | 3, readonly (readonly [fraction: number, reps: number])[]> = {
  1: [[0.6, 5]],
  2: [
    [0.5, 5],
    [0.75, 3],
  ],
  3: [
    [0.4, 5],
    [0.6, 3],
    [0.8, 1],
  ],
};

export const defaultWarmupCount = (workKg: number): 1 | 2 | 3 =>
  workKg < 60 ? 1 : workKg < 120 ? 2 : 3;

// Each load is rounded to what the equipment can load, never under the bar. Two sets that round
// to the same load become one (the earlier, longer set stays), and a set that would reach the
// working load is dropped.
export function warmupSets(
  workKg: number,
  count: WarmupCount,
  barKg: number,
  platesKg: readonly number[],
): WarmupSet[] {
  if (count === 0 || workKg <= barKg) return [];
  const sets: WarmupSet[] = [];
  for (const [fraction, reps] of SCHEMES[count]) {
    const { totalKg, perSideKg } = nearestLoading(workKg * fraction, barKg, platesKg);
    if (totalKg >= workKg || sets.some((s) => s.loadKg === totalKg)) continue;
    sets.push({ loadKg: totalKg, reps, perSideKg });
  }
  return sets;
}
