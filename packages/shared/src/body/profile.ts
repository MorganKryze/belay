import { AGE_RANGE_YEARS, HEIGHT_RANGE_CM } from "../tools/bounds";
import type { Formula } from "../tools/catalog";
import type { ISODate } from "./dates";

// The three optional facts of Settings › Profile (D8), each for the tools that use it. The age
// is never stored: it comes from the birth year and today.
export interface Profile {
  formula: Formula | null;
  birthYear: number | null;
  heightCm: number | null;
}
export const EMPTY_PROFILE: Profile = { formula: null, birthYear: null, heightCm: null };

const yearOf = (today: ISODate) => Number(today.slice(0, 4));

// The tools take ages 15 to 100: birth years from this year − 100 to this year − 15.
export function birthYearRange(today: ISODate): { min: number; max: number } {
  return { min: yearOf(today) - AGE_RANGE_YEARS.max, max: yearOf(today) - AGE_RANGE_YEARS.min };
}

export function isBirthYear(year: number, today: ISODate): boolean {
  const { min, max } = birthYearRange(today);
  return Number.isInteger(year) && year >= min && year <= max;
}

// The tools' height range, in whole centimetres.
export const isProfileHeight = (cm: number) =>
  Number.isInteger(cm) && cm >= HEIGHT_RANGE_CM.min && cm <= HEIGHT_RANGE_CM.max;

export const ageIn = (birthYear: number, today: ISODate) => yearOf(today) - birthYear;
