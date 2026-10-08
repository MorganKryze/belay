// Calendar days as "YYYY-MM-DD" strings, the person's local date. Arithmetic runs on UTC
// midnights, so no daylight-saving change can shift a day; strings compare in date order.
export type ISODate = string;

const DAY_MS = 86_400_000;
const toUtc = (date: ISODate) =>
  Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
const fromUtc = (ms: number): ISODate => new Date(ms).toISOString().slice(0, 10);

export const addDays = (date: ISODate, days: number): ISODate =>
  fromUtc(toUtc(date) + days * DAY_MS);

// Monday of the ISO week (weeks run Monday to Sunday).
export function isoWeekStart(date: ISODate): ISODate {
  const ms = toUtc(date);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return fromUtc(ms - sinceMonday * DAY_MS);
}

// The calendar day `now` falls on, where the person is. Callers pass the clock in.
export function toISODate(now: Date): ISODate {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
