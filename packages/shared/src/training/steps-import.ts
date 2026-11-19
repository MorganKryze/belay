// Which days of steps a Health import writes (spec R4). The caller reads Health for today and
// the 6 days before; a total is written while the day holds no row or holds this phone's own last
// write, so a value typed on the web is never silently replaced and a day deleted there stays deleted.
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
    if (rows.has(date) && rows.get(date) === null) continue; // deleted on purpose
    const stored = rows.get(date) ?? null;
    if (stored !== null && stored !== own.get(date)) continue; // typed elsewhere
    if (stored === value) continue;
    out.push({ date, value });
  }
  return out;
}
