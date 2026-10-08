import { addDays, type ISODate } from "./dates";

export type MeasureField = "waist" | "neck" | "hip";
export const MEASURE_FIELDS: readonly MeasureField[] = ["waist", "neck", "hip"];

// One day's measurements; each may be missing (or deleted: null).
export interface Measure {
  date: ISODate;
  waistCm: number | null;
  neckCm: number | null;
  hipCm: number | null;
}

// The body-fat tool's limits; kept to the tenth (numeric(4,1) on the server), nudged by 0.5.
export const MEASURE_BOUNDS: Record<MeasureField, { min: number; max: number; step: number }> = {
  waist: { min: 40, max: 200, step: 0.5 },
  neck: { min: 20, max: 80, step: 0.5 },
  hip: { min: 50, max: 200, step: 0.5 },
};

export function isMeasureCm(field: MeasureField, value: number): boolean {
  const { min, max } = MEASURE_BOUNDS[field];
  const tenths = value * 10;
  return (
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    Math.abs(tenths - Math.round(tenths)) < 1e-6
  );
}

const key = { waist: "waistCm", neck: "neckCm", hip: "hipCm" } as const;
export const measureOf = (m: Measure, field: MeasureField) => m[key[field]];

// The last value of each measurement, with its day.
export function latestMeasures(
  measures: readonly Measure[],
): Partial<Record<MeasureField, { cm: number; date: ISODate }>> {
  const out: Partial<Record<MeasureField, { cm: number; date: ISODate }>> = {};
  for (const m of measures)
    for (const field of MEASURE_FIELDS) {
      const cm = measureOf(m, field);
      if (cm !== null && (out[field] === undefined || m.date > out[field].date))
        out[field] = { cm, date: m.date };
    }
  return out;
}

// The waist of the week from Monday `weekStart`: its last value, or null.
export function weeklyWaist(measures: readonly Measure[], weekStart: ISODate): number | null {
  const end = addDays(weekStart, 6);
  return (
    latestMeasures(measures.filter((m) => m.date >= weekStart && m.date <= end)).waist?.cm ?? null
  );
}
