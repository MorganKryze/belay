// What only Programme and its rhythm sheet need of a fixed week: the cards in day order and a first
// week to propose. Kept apart from schedule so Accueil's startup bundle does not carry it.
import { addDays, type ISODate, isoWeekStart } from "../body/dates";
import {
  counts,
  dayOf,
  dayPlan,
  daysOf,
  type Done,
  fixedWeek,
  sinceOf,
  type Weekday,
  weekdayOf,
} from "./schedule";
import { DAYS, type LetteredTemplate, startedAs, type StoredPrograms } from "./stored-program";

export interface WeekCard {
  session: LetteredTemplate;
  next: ISODate | null;
  days: readonly Weekday[];
}

// The rotation by each session's next day, from today (skipped once today's session is done), so
// the first card is plannedNext's; sessions with no day follow in rotation order.
export function weekOrder(
  workouts: readonly Done[],
  p: StoredPrograms,
  rotation: readonly LetteredTemplate[],
  today: ISODate,
): WeekCard[] | null {
  const week = fixedWeek(p, rotation);
  if (!week) return null;
  const plan = dayPlan(workouts, p, rotation, today);
  const doneToday = plan.kind === "done" ? plan.session.sessionId : null;
  const cards = rotation.map((session) => {
    const from = session.sessionId === doneToday ? 1 : 0;
    const k = [0, 1, 2, 3, 4, 5, 6, 7].find(
      (k) => k >= from && week[weekdayOf(addDays(today, k))]?.sessionId === session.sessionId,
    );
    return {
      session,
      next: k === undefined ? null : addDays(today, k),
      days: daysOf(week, session.sessionId),
    };
  });
  // A stable sort keeps the rotation order among sessions with no day.
  return cards.sort((a, b) =>
    a.next === b.next ? 0 : a.next === null ? 1 : b.next === null || a.next < b.next ? -1 : 1,
  );
}

// The first week offered with no history, index = sessions - 1: spread over the week, Monday first.
export const STARTING_DAYS: readonly (readonly Weekday[])[] = [
  [0],
  [0, 3],
  [0, 2, 4],
  [0, 1, 3, 4],
  [0, 1, 2, 4, 5],
  [0, 1, 2, 3, 4, 5],
  [0, 1, 2, 3, 4, 5, 6],
];

// A weekday takes the session done on it in at least 2 of the last 4 weeks (distinct weeks, so a
// second start on one day adds nothing), the most often, a tie to the earlier letter. With no
// weekday learned, the starting pattern, sessions in rotation order; past 7, the first 7.
export function proposeWeek(
  workouts: readonly Done[],
  rotation: readonly LetteredTemplate[],
  today: ISODate,
  activeAt: string | null,
): { days: (string | null)[]; learned: boolean } {
  const days: (string | null)[] = Array<string | null>(DAYS).fill(null);
  if (rotation.length === 0) return { days, learned: false };
  const from = addDays(today, -28);
  const since = sinceOf(activeAt);
  const weeks = Array.from({ length: DAYS }, () => rotation.map(() => new Set<ISODate>()));
  for (const w of workouts) {
    const on = dayOf(w);
    if (!counts(w, since) || on < from || on >= today) continue;
    const at = rotation.findIndex((t) => startedAs(w, t));
    if (at >= 0) weeks[weekdayOf(on)]![at]!.add(isoWeekStart(on));
  }
  weeks.forEach((bySession, day) => {
    let most = 1;
    bySession.forEach((seen, at) => {
      if (seen.size > most) {
        most = seen.size;
        days[day] = rotation[at]!.sessionId;
      }
    });
  });
  if (days.some((d) => d !== null)) return { days, learned: true };
  STARTING_DAYS[Math.min(rotation.length, DAYS) - 1]!.forEach(
    (day, at) => (days[day] = rotation[at]!.sessionId),
  );
  return { days, learned: false };
}
