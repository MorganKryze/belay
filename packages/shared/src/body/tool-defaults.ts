import { AGE_RANGE_YEARS, HEIGHT_RANGE_CM, WEIGHT_RANGE_KG } from "../tools/bounds";
import type { Formula } from "../tools/catalog";
import { roundTo } from "../tools/round";
import type { ISODate } from "./dates";
import { latestMeasures, type Measure, MEASURE_BOUNDS } from "./measures";
import { ageIn, type Profile } from "./profile";
import { latestMovingAverage, type Weighing } from "./weighings";

export type ToolField =
  "formula" | "ageYears" | "heightCm" | "weightKg" | "neckCm" | "waistCm" | "hipCm";

// Where a prefilled value comes from, said under its field.
export type Source =
  | { from: "profile" }
  | { from: "birthYear" }
  | { from: "average" }
  | { from: "weighing" }
  | { from: "measures"; date: ISODate };

export type ToolDefault<V> = { value: V; source: Source };
export type ToolDefaults = {
  formula?: ToolDefault<Formula>;
} & Partial<Record<Exclude<ToolField, "formula">, ToolDefault<number>>>;

const inside = (value: number, { min, max }: { min: number; max: number }) =>
  value >= min && value <= max;

// What a connected tool opens with (§4.5): the profile, the 7-day average (else the last
// weigh-in), the last value of each measurement. A value outside the tools' bounds is left out,
// and the tool keeps the device's value for that field.
export function toolDefaults({
  profile,
  weighings,
  measures,
  today,
}: {
  profile: Profile;
  weighings: readonly Weighing[];
  measures: readonly Measure[];
  today: ISODate;
}): ToolDefaults {
  const out: ToolDefaults = {};
  if (profile.formula) out.formula = { value: profile.formula, source: { from: "profile" } };
  if (profile.birthYear !== null) {
    const age = ageIn(profile.birthYear, today);
    if (inside(age, AGE_RANGE_YEARS)) out.ageYears = { value: age, source: { from: "birthYear" } };
  }
  if (profile.heightCm !== null && inside(profile.heightCm, HEIGHT_RANGE_CM))
    out.heightCm = { value: profile.heightCm, source: { from: "profile" } };

  const past = weighings.filter((w) => w.date <= today);
  const last = past.reduce<Weighing | undefined>(
    (a, w) => (a && a.date > w.date ? a : w),
    undefined,
  );
  const average = latestMovingAverage(past, today);
  // The average only while it covers the last weigh-in: an old one says less than a recent day.
  const weight =
    average && last && average.date >= last.date
      ? { value: roundTo(average.averageKg, 0.1), source: { from: "average" } as const }
      : last
        ? { value: last.weightKg, source: { from: "weighing" } as const }
        : null;
  if (weight && inside(weight.value, WEIGHT_RANGE_KG)) out.weightKg = weight;

  const latest = latestMeasures(measures.filter((m) => m.date <= today));
  for (const [field, key] of [
    ["neck", "neckCm"],
    ["waist", "waistCm"],
    ["hip", "hipCm"],
  ] as const) {
    const m = latest[field];
    if (m && inside(m.cm, MEASURE_BOUNDS[field]))
      out[key] = { value: m.cm, source: { from: "measures", date: m.date } };
  }
  return out;
}
