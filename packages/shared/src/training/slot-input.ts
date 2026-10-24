// What a person types in a cell of the program editor, read the way they think it: « 6-10 »,
// « 6 10 » or « 8 » for a range, « 2:30 », « 2 min 30 » or « 150 » for a rest. Null when the text
// cannot be read or leaves the bounds, so nothing is saved. Never imported at startup: only the
// editor needs it.
import { SLOT_BOUNDS } from "./workout";

const WHOLE = /^\d+$/;
// Between the two ends of a range: a dash of any length, « à », « to », or spaces alone.
const BETWEEN = /\s*(?:[-–—]|à|to)\s*|\s+/;

// A whole number from min to max.
export function parseCount(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!WHOLE.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= min && n <= max ? n : null;
}

// One number n reads n–n; a reversed pair is put in order.
export function parseRange(
  text: string,
  min: number,
  max: number,
): readonly [number, number] | null {
  const parts = text.trim().toLowerCase().split(BETWEEN);
  if (parts.length > 2) return null;
  const ends = parts.map((part) => parseCount(part, min, max));
  const [a, b = a] = ends;
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a <= b ? [a, b] : [b, a];
}

const REST_FORMS = [
  /^(\d+):(\d{2})$/, // 2:30
  /^(\d+)\s*min(?:\s*(\d{1,2})(?:\s*s)?)?$/, // 2 min 30, 2 min
  /^(\d+)['’](\d{2})$/, // 2'30
];

// Seconds from 0 to 15 min; a bare number is seconds.
export function parseRest(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  const bare = /^(\d+)(?:\s*s)?$/.exec(trimmed);
  let seconds: number | null = bare ? Number(bare[1]) : null;
  for (const form of REST_FORMS) {
    const match = form.exec(trimmed);
    if (!match) continue;
    const rest = Number(match[2] ?? 0);
    if (rest < 60) seconds = Number(match[1]) * 60 + rest;
  }
  return seconds !== null && seconds <= SLOT_BOUNDS.restSec ? seconds : null;
}

// « 2:30 », the way a clock writes a rest.
export const restClock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
