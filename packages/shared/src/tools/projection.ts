// Rates: Garthe 2011 and Helms 2014 (JISSN), 0.5–1 % of body weight per week. The +30 % that
// gives the late date has no source: the whole date range is a Belay heuristic.
export const RATE_PRESETS = [
  { id: "gentle", pct: 0.5 },
  { id: "balanced", pct: 0.75 },
  { id: "steady", pct: 1 },
] as const;
export type RatePresetId = (typeof RATE_PRESETS)[number]["id"];
export const RATE_MIN_PCT = 0.25;
export const RATE_MAX_PCT = 2.5;
export const RATE_STEP_PCT = 0.05;

export type RateWarning = "none" | "above-1" | "above-1.5";
export const rateWarning = (pctPerWeek: number): RateWarning =>
  pctPerWeek > 1.5 ? "above-1.5" : pctPerWeek > 1 ? "above-1" : "none";

export const kgPerWeek = (currentKg: number, pctPerWeek: number): number =>
  (currentKg * pctPerWeek) / 100;

// ⌈1.3 × n⌉ in integers: 13 × n / 10 is exact, 1.3 × n is not always.
export const slowWeeks = (fastWeeks: number): number => Math.ceil((13 * fastWeeks) / 10);

// Calendar weeks in local time: crosses DST changes and the new year without drifting an hour.
export const addWeeks = (date: Date, weeks: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7 * weeks);

export type Projection =
  | { kind: "ok"; weeksLow: number; weeksHigh: number; dateLow: Date; dateHigh: Date }
  | { kind: "target-not-below" };

export function projectLoss(
  currentKg: number,
  targetKg: number,
  pctPerWeek: number,
  today: Date,
): Projection {
  if (
    !(Number.isFinite(currentKg) && currentKg > 0) ||
    !(Number.isFinite(targetKg) && targetKg > 0)
  ) {
    throw new RangeError("weights must be positive numbers");
  }
  if (!(pctPerWeek >= RATE_MIN_PCT && pctPerWeek <= RATE_MAX_PCT)) {
    throw new RangeError(`rate must be from ${RATE_MIN_PCT} to ${RATE_MAX_PCT} % per week`);
  }
  if (!(targetKg < currentKg)) return { kind: "target-not-below" };
  // Lose pct of the current weight each week: kg per week shrink as weight falls.
  const raw = Math.log(targetKg / currentKg) / Math.log(1 - pctPerWeek / 100);
  const weeksLow = Math.max(1, Math.ceil(raw - 1e-9)); // 12.0000000001 is 12 weeks, not 13
  const weeksHigh = slowWeeks(weeksLow);
  return {
    kind: "ok",
    weeksLow,
    weeksHigh,
    dateLow: addWeeks(today, weeksLow),
    dateHigh: addWeeks(today, weeksHigh),
  };
}
