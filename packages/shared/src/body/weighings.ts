import { addDays, type ISODate, isoWeekStart } from "./dates";

export interface Weighing {
  date: ISODate;
  weightKg: number;
}

export const WEIGHING_RANGE_KG = { min: 20, max: 400, step: 0.1 } as const;
// No weigh-in is dated before this: a mistyped year (0202) would make every render walk centuries
// of days, and year 0000 is refused by Postgres. ISO dates compare as text.
export const MIN_WEIGH_IN_DATE: ISODate = "1900-01-01";
// Belay heuristic: a week, or a 7-day window, says something from 4 weigh-ins on.
export const MIN_WEIGHINGS = 4;

// 20.0 to 400.0 kg, in steps of 0.1 kg (the tolerance absorbs binary noise such as 79.8 × 10).
export function isWeighingKg(value: number): boolean {
  const { min, max } = WEIGHING_RANGE_KG;
  const tenths = value * 10;
  return (
    Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    Math.abs(tenths - Math.round(tenths)) < 1e-6
  );
}

const byDate = (a: Weighing, b: Weighing) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const mean = (values: readonly number[]) => values.reduce((s, v) => s + v, 0) / values.length;

// The 7-day moving average of every day from `from` to `to`, on the days where the window
// [day − 6, day] holds at least 4 weigh-ins. Weigh-ins before `from` count for the first days.
export function movingAverageSeries(
  ws: readonly Weighing[],
  from: ISODate,
  to: ISODate,
): { date: ISODate; averageKg: number }[] {
  const sorted = [...ws].sort(byDate);
  const out: { date: ISODate; averageKg: number }[] = [];
  let lo = 0;
  let hi = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    while (hi < sorted.length && sorted[hi]!.date <= day) hi++;
    const start = addDays(day, -6);
    while (lo < hi && sorted[lo]!.date < start) lo++;
    if (hi - lo >= MIN_WEIGHINGS)
      out.push({ date: day, averageKg: mean(sorted.slice(lo, hi).map((w) => w.weightKg)) });
  }
  return out;
}

// Average of the weigh-ins in [on − 6 days, on]; null with fewer than 4.
export function movingAverage7(ws: readonly Weighing[], on: ISODate): number | null {
  return movingAverageSeries(ws, on, on)[0]?.averageKg ?? null;
}

// The most recent day, up to `today`, that has a 7-day average.
export function latestMovingAverage(
  ws: readonly Weighing[],
  today: ISODate,
): { date: ISODate; averageKg: number } | null {
  if (ws.length === 0) return null;
  const first = ws.reduce((m, w) => (w.date < m ? w.date : m), ws[0]!.date);
  return movingAverageSeries(ws, first, today).at(-1) ?? null;
}

export interface WeekSummary {
  start: ISODate; // Monday
  end: ISODate; // Sunday
  count: number;
  status: "in_progress" | "valid" | "insufficient";
  averageKg: number | null; // only for "valid"
  // (average of week n − 1 − average of week n) / average of week n − 1 × 100, positive when
  // losing; null unless both weeks are "valid".
  lossPct: number | null;
}

// Every ISO week from the first weigh-in to the week of `today`, most recent first. The week
// holding `today` is in progress: never valid, never part of a loss. A weigh-in dated after
// `today` (a timezone change) lands in an in-progress week too.
export function weeklySummaries(ws: readonly Weighing[], today: ISODate): WeekSummary[] {
  if (ws.length === 0) return [];
  const current = isoWeekStart(today);
  const byWeek = new Map<ISODate, number[]>();
  for (const w of ws) {
    const start = isoWeekStart(w.date);
    byWeek.set(start, [...(byWeek.get(start) ?? []), w.weightKg]);
  }
  const starts = [...byWeek.keys(), current].sort();
  const out: WeekSummary[] = [];
  let previous: WeekSummary | undefined;
  for (let start = starts[0]!; start <= starts.at(-1)!; start = addDays(start, 7)) {
    const kgs = byWeek.get(start) ?? [];
    const status =
      start >= current ? "in_progress" : kgs.length >= MIN_WEIGHINGS ? "valid" : "insufficient";
    const averageKg = status === "valid" ? mean(kgs) : null;
    const before = previous?.averageKg ?? null;
    const week: WeekSummary = {
      start,
      end: addDays(start, 6),
      count: kgs.length,
      status,
      averageKg,
      lossPct: averageKg !== null && before !== null ? ((before - averageKg) / before) * 100 : null,
    };
    out.push(week);
    previous = week;
  }
  return out.reverse();
}
