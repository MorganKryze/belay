import type { ISODate } from "../body/dates";
import { isTargetRange } from "../body/target";
import { isWeighingKg, MIN_WEIGH_IN_DATE } from "../body/weighings";
import type { Change, WeightChange } from "./schema";

// The phone's own check before a change enters its queue, without Zod: this runs in the initial
// bundle. Stricter than ChangeSchema (a subset of what the server accepts), so a queued change
// is never refused, which would block the whole queue.
const isISODate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  s >= MIN_WEIGH_IN_DATE &&
  new Date(`${s}T00:00:00.000Z`).toISOString().startsWith(s);
const isISOTime = (s: string) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString() === s;

export function isValidChange(change: Change): boolean {
  if (!isISOTime(change.at)) return false;
  return change.kind === "weight"
    ? isISODate(change.date) && (change.weightKg === null || isWeighingKg(change.weightKg))
    : isTargetRange(change);
}

// A weigh-in is never dated after the phone's today (the server cannot know the timezone).
export const isRecordableWeight = (change: WeightChange, today: ISODate) =>
  isValidChange(change) && change.date <= today;
