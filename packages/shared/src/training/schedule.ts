// A program's week on fixed days: the session each weekday holds, what today asks for and the next
// session. Zod-free: Accueil reads it at startup, so what only Programme needs is in schedule-week.
import { addDays, type ISODate, toISODate } from "../body/dates";
import {
  DAYS,
  type LetteredTemplate,
  nextInRotation,
  startedAs,
  type StoredPrograms,
} from "./stored-program";

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // Monday 0, as a schedule's days

// A day string parses as UTC midnight, so the weekday never depends on the time zone.
export const weekdayOf = (day: ISODate): Weekday =>
  ((new Date(day).getUTCDay() + 6) % 7) as Weekday;

export type Week = readonly (LetteredTemplate | null)[]; // 7 entries, Monday first

// The active program's days as rotation sessions, by id: a session set aside, removed, emptied or
// moved to another program leaves its day a rest day, and the day comes back with it. A week that
// holds no session offers nothing, so the program runs in rotation instead.
export function fixedWeek(p: StoredPrograms, rotation: readonly LetteredTemplate[]): Week | null {
  const program = p.programs.find((x) => x.id === p.activeId && !x.removed);
  if (program?.schedule.mode !== "fixed") return null;
  const week = Array.from(
    { length: DAYS },
    (_, i) => rotation.find((t) => t.sessionId === program.schedule.days[i]) ?? null,
  );
  return week.some((t) => t !== null) ? week : null;
}

export const sessionDays = (week: Week): number => week.filter((t) => t !== null).length;

export const daysOf = (week: Week, sessionId: string): Weekday[] =>
  week.flatMap((t, i) => (t?.sessionId === sessionId ? [i as Weekday] : []));

export interface Done {
  id: string;
  sessionCode: string;
  sessionId?: string | null;
  startedAt: string;
  endedAt: string | null;
  removed: boolean;
}
export interface Planned {
  session: LetteredTemplate;
  day: ISODate;
}
export type DayPlan<W extends Done = Done> =
  | { kind: "rotation"; next: LetteredTemplate | null }
  | { kind: "due"; session: LetteredTemplate; next: Planned }
  | { kind: "done"; session: LetteredTemplate; workout: W; on: ISODate; next: Planned }
  | { kind: "rest"; next: Planned };

// A session counts on the calendar day it started, where the person is.
export const dayOf = (w: Done): ISODate => toISODate(new Date(w.startedAt));

// Finished and kept; one recorded by letter only counts since the program became active, as a
// letter names another session elsewhere.
export const counts = (w: Done, since: number): boolean =>
  w.endedAt !== null && !w.removed && (!!w.sessionId || Date.parse(w.startedAt) >= since);
export const sinceOf = (activeAt: string | null) =>
  activeAt === null ? -Infinity : Date.parse(activeAt);

// The nearest session day 1 to 7 days from `day`, forward or back; a fixed week holds one.
const sessionDay = (week: Week, day: ISODate, step: 1 | -1): ISODate =>
  addDays(day, step * [1, 2, 3, 4, 5, 6, 7].find((k) => week[weekdayOf(addDays(day, step * k))])!);

// On fixed days, today's session stays due until it is done after the previous session day, so a
// session done early counts for its day and a missed one is never carried over.
export function dayPlan<W extends Done>(
  workouts: readonly W[],
  p: StoredPrograms,
  rotation: readonly LetteredTemplate[],
  today: ISODate,
): DayPlan<W> {
  const week = fixedWeek(p, rotation);
  if (!week) return { kind: "rotation", next: nextInRotation(workouts, rotation, p.activeAt) };
  const day = sessionDay(week, today, 1);
  const next = { session: week[weekdayOf(day)]!, day };
  const session = week[weekdayOf(today)];
  if (!session) return { kind: "rest", next };
  const after = sessionDay(week, today, -1);
  const since = sinceOf(p.activeAt);
  let workout: W | null = null;
  for (const w of workouts) {
    const on = dayOf(w);
    if (!counts(w, since) || !startedAs(w, session) || on <= after || on > today) continue;
    // Times compared as instants; two starts at the same instant: the greater id, on every device.
    const ahead = workout === null ? 1 : Date.parse(w.startedAt) - Date.parse(workout.startedAt);
    if (ahead > 0 || (ahead === 0 && w.id > workout!.id)) workout = w;
  }
  return workout
    ? { kind: "done", session, workout, on: dayOf(workout), next }
    : { kind: "due", session, next };
}

export function plannedNext(
  workouts: readonly Done[],
  p: StoredPrograms,
  rotation: readonly LetteredTemplate[],
  today: ISODate,
): LetteredTemplate | null {
  const plan = dayPlan(workouts, p, rotation, today);
  return plan.kind === "rotation"
    ? plan.next
    : plan.kind === "due"
      ? plan.session
      : plan.next.session;
}
