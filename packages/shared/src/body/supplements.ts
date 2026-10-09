import { addDays, type ISODate } from "./dates";

export type SupplementKind = "creatine" | "other";
export const SUPPLEMENT_NAME_MAX = 40;

// 1 to 40 characters once trimmed, on one line.
export const isSupplementName = (name: string) =>
  name.trim().length >= 1 && name.trim().length <= SUPPLEMENT_NAME_MAX && !/[\r\n]/.test(name);

// The suggestions of Settings › My supplements, as translation keys. Belay notes what is taken,
// never a dose or advice.
export const SUPPLEMENT_SUGGESTIONS = [
  "creatine",
  "vitaminD",
  "omega3",
  "magnesium",
  "iron",
  "zinc",
  "caffeine",
  "melatonin",
] as const;

// "Créatine", "creatine", "CREATINE monohydrate": case and accents aside, the word creatine.
export function isCreatineName(name: string): boolean {
  const plain = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
  return /(^|[^a-z])creatine([^a-z]|$)/.test(plain);
}

// Belay heuristic (D3): a course of creatine starts on a day ticked after at least 14 days
// without; its first 14 days are marked, when the weight often rises by 1 to 2 kg of water.
export const CREATINE_DAYS = 14;

// The marked windows, oldest first: each start is a ticked day with no ticked day in the 14 days
// before it, and the window runs 14 days, the start included. Days after `today` (a timezone
// change) are left out.
export function creatineWindows(
  takenDays: readonly ISODate[],
  today: ISODate,
): { start: ISODate; end: ISODate }[] {
  const days = [...new Set(takenDays)].filter((d) => d <= today).sort();
  const out: { start: ISODate; end: ISODate }[] = [];
  let previous: ISODate | null = null;
  for (const day of days) {
    if (previous === null || day > addDays(previous, CREATINE_DAYS))
      out.push({ start: day, end: addDays(day, CREATINE_DAYS - 1) });
    previous = day;
  }
  return out;
}
