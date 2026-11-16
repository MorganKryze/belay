// Which days of steps a Health import writes (spec R4). The caller reads Health for today and
// the 6 days before; a total is written while the stored steps are empty or are this phone's own
// last write, so a value typed on the web is never silently replaced.
import type { ISODate } from "../body/dates";
import { isSteps } from "./activities";

export function stepsToWrite(
  days: readonly { date: ISODate; total: number | null }[],
  rows: ReadonlyMap<ISODate, number | null>,
  own: ReadonlyMap<ISODate, number>,
): { date: ISODate; value: number }[] {
  const out: { date: ISODate; value: number }[] = [];
  for (const { date, total } of days) {
    if (total === null) continue; // no samples that day
    const value = Math.round(total);
    if (!isSteps(value)) continue; // past the 100 000 steps a day holds
    const stored = rows.get(date) ?? null;
    if (stored !== null && stored !== own.get(date)) continue; // typed elsewhere
    if (stored === value) continue;
    out.push({ date, value });
  }
  return out;
}
