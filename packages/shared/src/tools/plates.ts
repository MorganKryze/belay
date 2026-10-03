// IWF Technical and Competition Rules 2020, rule 3.3.3.6. There is no 1.25 kg IWF disc and no
// official colour for one: every value outside this table is drawn neutral grey.
export type IwfColor = "red" | "blue" | "yellow" | "green" | "white";
const IWF_COLORS: Readonly<Record<number, IwfColor>> = {
  25: "red",
  20: "blue",
  15: "yellow",
  10: "green",
  5: "white",
  2.5: "red",
  2: "blue",
  1.5: "yellow",
  1: "green",
  0.5: "white",
};
export const iwfColor = (kg: number): IwfColor | null => IWF_COLORS[kg] ?? null;

export const PLATE_PRESETS = {
  competition: { barKg: 20, platesKg: [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1, 0.5] },
  gym: { barKg: 20, platesKg: [20, 10, 5, 2.5] },
} as const;
export type PlatePreset = keyof typeof PLATE_PRESETS;

// What "Custom" offers as one-tap chips; any other value can be added by hand.
export const STANDARD_PLATES_KG = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1.25, 1, 0.5] as const;
export const STANDARD_BARS_KG = [20, 15, 10] as const;

export type Loading = { totalKg: number; perSideKg: number[] };
export type BarLoad =
  | { kind: "exact"; loading: Loading }
  | { kind: "unreachable"; below: Loading | null; above: Loading | null };

const toCenti = (kg: number) => Math.round(kg * 100);

// Fewest plates per side for the target. Integers in hundredths of a kilo, so 2.5 + 1.25 never
// drifts. ponytail: assumes as many plates of each weight as needed; add a per-plate stock if
// someone's gym runs short.
export function loadBar(targetKg: number, barKg: number, platesKg: readonly number[]): BarLoad {
  const bar = toCenti(barKg);
  const plates = [...new Set(platesKg.map(toCenti))].filter((p) => p > 0).sort((a, b) => b - a);
  const half = (toCenti(targetKg) - bar) / 2;
  const barOnly: Loading = { totalKg: bar / 100, perSideKg: [] };
  if (half < 0) return { kind: "unreachable", below: null, above: barOnly };

  // count[a] = fewest plates adding up to a, Infinity when no combination does.
  const limit = Math.ceil(half) + (plates[0] ?? 0);
  const count = new Array<number>(limit + 1).fill(Infinity);
  count[0] = 0;
  for (let a = 1; a <= limit; a++) {
    for (const p of plates) {
      if (p <= a && count[a - p]! + 1 < count[a]!) count[a] = count[a - p]! + 1;
    }
  }
  // Heaviest plate first among the optimal choices: "20 + 10 + 5", never "5 + 10 + 20".
  const loading = (amount: number): Loading => {
    const side: number[] = [];
    for (let rest = amount; rest > 0;) {
      const p = plates.find((q) => q <= rest && count[rest - q] === count[rest]! - 1)!;
      side.push(p / 100);
      rest -= p;
    }
    return { totalKg: (bar + 2 * amount) / 100, perSideKg: side };
  };

  if (Number.isInteger(half) && count[half] !== Infinity) {
    return { kind: "exact", loading: loading(half) };
  }
  let lo = Math.floor(half);
  while (count[lo] === Infinity) lo--; // count[0] is 0, so this stops
  let hi = Math.ceil(half);
  while (hi <= limit && count[hi] === Infinity) hi++;
  return { kind: "unreachable", below: loading(lo), above: hi <= limit ? loading(hi) : null };
}

// The reachable load closest to the target; a tie goes to the lighter one.
export function nearestLoading(
  targetKg: number,
  barKg: number,
  platesKg: readonly number[],
): Loading {
  const r = loadBar(targetKg, barKg, platesKg);
  if (r.kind === "exact") return r.loading;
  if (r.below === null) return r.above!;
  if (r.above === null) return r.below;
  return targetKg - r.below.totalKg <= r.above.totalKg - targetKg ? r.below : r.above;
}
