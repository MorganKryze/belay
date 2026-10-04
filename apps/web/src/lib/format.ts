import { decimalsOf } from "@belay/shared/tools/round";

export { decimalsOf };

// "72,5" in French, "72.5" in English. Grouping is for results ("2 770"), never for inputs.
export function formatNumber(
  value: number,
  locale: string,
  { digits = 1, minDigits = 0, grouping = true } = {},
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
    minimumFractionDigits: minDigits,
    useGrouping: grouping,
  }).format(value);
}

// Accepts what a person types on either keyboard: "72,5", "72.5", " 72 ", and the French
// thousands separator (a narrow no-break space, which \s matches) when a grouped value is
// pasted. Returns null for anything else, including an empty field.
export function parseDecimal(text: string): number | null {
  const clean = text.replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(clean)) return null;
  return Number(clean);
}

// "20 + 10 + 5" with the locale's decimal separator.
export const formatPlates = (plates: readonly number[], locale: string): string =>
  plates.map((p) => formatNumber(p, locale, { digits: 2 })).join(" + ");

// "26 décembre", or "23 janvier 2027" when the year is not this year's.
export function formatDay(date: Date, locale: string, today: Date): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  }).format(date);
}
