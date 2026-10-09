import type { ISODate } from "@belay/shared/body/dates";
import { decimalsOf, roundTo } from "@belay/shared/tools/round";
import type { TFunction } from "i18next";

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

// "26 décembre", "1er janvier", or "23 janvier 2027" when the year is not this year's.
export function formatDay(date: Date, locale: string, today: Date): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() === today.getFullYear() ? {} : { year: "numeric" }),
  })
    .formatToParts(date)
    .map((p) => (p.type === "day" && p.value === "1" && locale.startsWith("fr") ? "1er" : p.value))
    .join("");
}

// Weights and averages to the tenth, always with their decimal: "80,0", "79,8".
export const formatKg = (kg: number, locale: string): string =>
  formatNumber(kg, locale, { digits: 1, minDigits: 1 });

// A weekly change as shown: to the tenth, a loss or a gain, never "-0". The size is rounded,
// not the signed value, so a gain of 0.25 shows 0.3 like a loss of 0.25 does.
export function lossView(lossPct: number): { kind: "loss" | "gain"; value: number } {
  const value = roundTo(Math.abs(lossPct), 0.1);
  return { kind: lossPct < 0 && value > 0 ? "gain" : "loss", value };
}

// A calendar day of the person ("YYYY-MM-DD"), written in UTC so no timezone shifts it.
function dayText(date: ISODate, locale: string, today: ISODate, weekday: boolean): string {
  return new Intl.DateTimeFormat(locale, {
    ...(weekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  })
    .formatToParts(new Date(`${date}T00:00:00Z`))
    .map((p) => (p.type === "day" && p.value === "1" && locale.startsWith("fr") ? "1er" : p.value))
    .join("");
}

// "30 sept.", "1er oct.", "29 déc. 2025"; "Sep 30" in English.
export const formatShortDay = (date: ISODate, locale: string, today: ISODate): string =>
  dayText(date, locale, today, false);

// "Mer. 30 sept.", "Wed, Sep 30": the day of a weigh-in, starting a line; inside a sentence
// ("Pesée du mer. 30 sept."), as the language writes it.
export function formatWeekday(
  date: ISODate,
  locale: string,
  today: ISODate,
  { startOfLine = true } = {},
): string {
  const text = dayText(date, locale, today, true);
  return startOfLine ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// "22 – 28 sept.", "29 sept. – 5 oct.", "Sep 22 – 28": the month once when the week shares it.
export function formatWeekRange(
  start: ISODate,
  end: ISODate,
  locale: string,
  today: ISODate,
): string {
  const full = (d: ISODate) => formatShortDay(d, locale, today);
  const dayFirst = /^\d/.test(full(end));
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  if (!sameMonth || (!dayFirst && start.slice(0, 4) !== today.slice(0, 4)))
    return `${full(start)} – ${full(end)}`;
  const day = (d: ISODate) =>
    locale.startsWith("fr") && d.endsWith("-01") ? "1er" : String(Number(d.slice(8)));
  return dayFirst ? `${day(start)} – ${full(end)}` : `${full(start)} – ${day(end)}`;
}

// "Séance A · Push": a session of the program by its code (M3a's program is a constant).
export const sessionTitle = (code: string, t: TFunction): string =>
  t("program.session", { code, name: t(`program.names.${code}`) });
