// Activities outside the gym (spec §5): cardio and climbing, by an id the phone gives, and the
// day's steps. Pure, with every bound the phone and the server share.
import { addDays, type ISODate, isoWeekStart } from "../body/dates";

export const ACTIVITY_KINDS = ["cardio", "climbing"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const CARDIO_TYPES = ["run", "bike", "row", "walk", "swim", "other"] as const;
export type CardioType = (typeof CARDIO_TYPES)[number];
export const CLIMB_STYLES = ["boulder", "route"] as const;
export type ClimbStyle = (typeof CLIMB_STYLES)[number];
// The French scale, the same list for boulders and routes: 5a, 5a+, 5b … 8c, 8c+.
export const CLIMB_GRADES: readonly string[] = ["5", "6", "7", "8"].flatMap((n) =>
  ["a", "b", "c"].flatMap((l) => [`${n}${l}`, `${n}${l}+`]),
);
// The colours gyms mark their circuits with, always written out next to the colour.
export const CLIMB_COLORS = ["yellow", "green", "blue", "red", "black", "purple", "white"] as const;
export type ClimbColor = (typeof CLIMB_COLORS)[number];

export const ACTIVITY_MINUTES = { min: 5, max: 480, step: 5 } as const;
export const CLIMB_RUNS = { min: 0, max: 200 } as const;
export const STEPS = { min: 0, max: 100_000, step: 100 } as const;

// One activity: its day, kind and fields travel together (one block, as an annotation).
export interface Activity {
  id: string;
  date: ISODate;
  kind: ActivityKind;
  durationMin: number;
  cardioType: CardioType | null; // cardio only
  climbStyle: ClimbStyle | null; // climbing only, each optional
  climbRuns: number | null;
  climbGrade: string | null; // a grade or a colour, never both
  climbColor: ClimbColor | null;
  removed: boolean;
}
export type ActivityFields = Omit<Activity, "id" | "removed">;
// The day's steps, typed by hand (a web app reads neither Health nor Health Connect).
export interface StepsLog {
  date: ISODate;
  steps: number | null; // null: deleted
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  (list as readonly unknown[]).includes(v);

export const isActivityMinutes = (v: number) =>
  isInt(v, ACTIVITY_MINUTES.min, ACTIVITY_MINUTES.max) && v % ACTIVITY_MINUTES.step === 0;
export const isClimbRuns = (v: number) => isInt(v, CLIMB_RUNS.min, CLIMB_RUNS.max);
// Whole steps; the stepper's 100 is only its nudge, a typed 8 437 is fine.
export const isSteps = (v: number) => isInt(v, STEPS.min, STEPS.max);
export const isClimbGrade = (v: string) => CLIMB_GRADES.includes(v);

// The block of an activity: a cardio type for cardio only, the climbing fields for climbing
// only, a grade or a colour but not both.
export function isActivityFields(f: Omit<ActivityFields, "date">): boolean {
  if (!isOneOf(ACTIVITY_KINDS, f.kind) || !isActivityMinutes(f.durationMin)) return false;
  if (f.kind === "cardio")
    return (
      isOneOf(CARDIO_TYPES, f.cardioType) &&
      f.climbStyle === null &&
      f.climbRuns === null &&
      f.climbGrade === null &&
      f.climbColor === null
    );
  return (
    f.cardioType === null &&
    (f.climbStyle === null || isOneOf(CLIMB_STYLES, f.climbStyle)) &&
    (f.climbRuns === null || isClimbRuns(f.climbRuns)) &&
    (f.climbGrade === null || (typeof f.climbGrade === "string" && isClimbGrade(f.climbGrade))) &&
    (f.climbColor === null || isOneOf(CLIMB_COLORS, f.climbColor)) &&
    (f.climbGrade === null || f.climbColor === null)
  );
}

// The week from Monday to Sunday (local dates) that holds `date`.
export function weekOf(date: ISODate): { start: ISODate; end: ISODate } {
  const start = isoWeekStart(date);
  return { start, end: addDays(start, 6) };
}

// Session C's rule reads this: a climb not removed, any day of `date`'s week.
export function climbedThisWeek(
  activities: readonly Pick<Activity, "date" | "kind" | "removed">[],
  date: ISODate,
): boolean {
  const { start, end } = weekOf(date);
  return activities.some(
    (a) => !a.removed && a.kind === "climbing" && a.date >= start && a.date <= end,
  );
}

// The day's steps, if any were typed.
export const stepsOf = (logs: readonly StepsLog[], day: ISODate): number | null =>
  logs.find((l) => l.date === day)?.steps ?? null;

// What Home's « Activité » line says about a day: nothing yet, the steps, the one activity, or
// how many there are (the steps count as one).
export type DaySummary =
  | { kind: "none" }
  | { kind: "steps"; steps: number }
  | { kind: "activity"; activity: Activity }
  | { kind: "many"; count: number };

export function activitySummary(
  activities: readonly Activity[],
  logs: readonly StepsLog[],
  day: ISODate,
): DaySummary {
  const own = activities.filter((a) => !a.removed && a.date === day);
  const steps = stepsOf(logs, day);
  const count = own.length + (steps === null ? 0 : 1);
  if (count === 0) return { kind: "none" };
  if (count > 1) return { kind: "many", count };
  return steps === null ? { kind: "activity", activity: own[0]! } : { kind: "steps", steps };
}
