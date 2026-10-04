// Spec ranges shared by the tools that take a body: the UI steppers never go outside them.
export const AGE_RANGE_YEARS = { min: 15, max: 100 } as const;
export const HEIGHT_RANGE_CM = { min: 120, max: 230 } as const;
export const WEIGHT_RANGE_KG = { min: 30, max: 300 } as const;

const within = (value: number, { min, max }: { min: number; max: number }) =>
  Number.isFinite(value) && value >= min && value <= max;

export function assertBody(weightKg: number, heightCm: number): void {
  if (!within(weightKg, WEIGHT_RANGE_KG)) throw new RangeError("weight out of range");
  if (!within(heightCm, HEIGHT_RANGE_CM)) throw new RangeError("height out of range");
}

export function assertAge(ageYears: number): void {
  if (!within(ageYears, AGE_RANGE_YEARS)) throw new RangeError("age out of range");
}
