// The weight unit a person reads and types in, and the formatters that follow it. Startup-safe:
// Accueil shows a body weight, so this imports only the preference, the number format and the
// shared conversions (the set grid and roundTo are startup modules already, through the router
// and the number format).
import {
  kgFromLoad,
  kgToLb,
  lbToKg,
  loadFromKg,
  rangeIn,
  stepIn,
  weighingFromKg,
  type WeightUnit,
} from "@belay/shared/tools/units";
import { isSetKg } from "@belay/shared/training/workout";
import { roundTo } from "@belay/shared/tools/round";
import { formatKg, formatNumber, parseDecimal } from "./format";
import { preference } from "./preference";

export type { WeightUnit };

// A device preference, as the theme: read on each render, never kept in module state.
export const [readWeightUnit, setWeightUnit] = preference<WeightUnit>(
  "belay.weightUnit",
  "kg",
  "lb",
);

// Body weight to the tenth, always with its decimal: "80,4" in kg, "177,2" in lb.
export const bodyWeight = (kg: number, locale: string, unit = readWeightUnit()): string =>
  formatKg(weighingFromKg(kg, unit), locale);

// "80,4 kg", "177,2 lb": the symbol is not translated.
export const bodyWeightText = (kg: number, locale: string, unit = readWeightUnit()): string =>
  `${bodyWeight(kg, locale, unit)} ${unit}`;

// A load as typed and shown: kg to two decimals ("82,5"), lb in whole pounds ("182"). Grouping is
// for results only, never for an input's value.
export const loadNumber = (
  kg: number,
  locale: string,
  unit = readWeightUnit(),
  grouping = false,
): string =>
  formatNumber(loadFromKg(kg, unit), locale, { digits: unit === "kg" ? 2 : 0, grouping });

// Typed text to kg on the set grid, or null: not a number, or outside SET_KG once converted. Text
// that still reads as the prefilled load gives that load back: 100 kg shown "220" lb stays 100.
export function parseLoad(
  text: string,
  unit = readWeightUnit(),
  prefillKg?: number,
): number | null {
  const value = parseDecimal(text);
  if (value === null) return null;
  const kg = kgFromLoad(value, unit);
  if (prefillKg !== undefined && kg === kgFromLoad(loadFromKg(prefillKg, unit), unit))
    return prefillKg;
  return isSetKg(kg) ? kg : null;
}

// A weight stepper in the unit: what NumberStepper takes, and the way back to kg. toKg is not
// rounded: the tools store unrounded kg, and the weigh-in sheet rounds with kgFromWeighing. The
// value shown, handed back untouched, gives the kg it came from: 80 kg stays 80, not 79.83.
export function weightStepper(
  kg: number,
  rangeKg: { min: number; max: number },
  stepKg: number,
  unit = readWeightUnit(),
): {
  unit: WeightUnit;
  value: number;
  min: number;
  max: number;
  step: number;
  toKg: (v: number) => number;
} {
  if (unit === "kg")
    return { unit, value: kg, min: rangeKg.min, max: rangeKg.max, step: stepKg, toKg: (v) => v };
  const step = stepIn(stepKg, unit);
  const value = roundTo(kgToLb(kg), step);
  return {
    unit,
    value,
    ...rangeIn(rangeKg, unit, step),
    step,
    toKg: (v) => (v === value ? kg : lbToKg(v)),
  };
}
