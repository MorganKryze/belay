// The programs, days and finished sessions the schedule suites share.
import { type ISODate } from "../body/dates";
import { dayPlan, type Done } from "./schedule";
import {
  DEFAULT_SCHEDULE,
  type ProgramSlot,
  rotationOf,
  type Schedule,
  seedId,
  type StoredPrograms,
} from "./stored-program";

const P1 = seedId(0xa01);
export const P2 = seedId(0xa02);
export const S = (i: number) => seedId(0xb00 + i);
export const UNKNOWN = seedId(0xfff);

// The week of 2026-10-19; Paris leaves summer time on Sunday 25.
export const MON = "2026-10-19";
export const TUE = "2026-10-20";
export const WED = "2026-10-21";
export const THU = "2026-10-22";
export const SAT = "2026-10-24";
export const SUN = "2026-10-25";
export const NEXT_MON = "2026-10-26";

export const fixed = (days: (string | null)[]): Schedule => ({ mode: "fixed", days });
// Monday A, Wednesday B, Saturday C.
export const MWS = fixed([S(0), null, S(1), null, null, S(2), null]);
// Monday A alone.
export const MONDAYS = fixed([S(0), null, null, null, null, null, null]);

const slot = (i: number, sessionId: string): ProgramSlot => ({
  id: seedId(0xc00 + i),
  sessionId,
  exerciseId: "ds:0025",
  sets: 3,
  repRange: [8, 12],
  rirTarget: [1, 2],
  restSec: 90,
  warmupSets: 0,
  isMain: false,
  groupKey: null,
  position: 0,
  rule: null,
  removed: false,
});
// n sessions in P1 at positions 0..n-1, each with one normal slot; P1 active with the schedule given.
export function stored(
  n: number,
  schedule: Schedule = DEFAULT_SCHEDULE,
  patch: Partial<StoredPrograms> = {},
): StoredPrograms {
  return {
    activeId: P1,
    activeAt: null,
    programs: [
      { id: P1, name: null, schedule, removed: false },
      { id: P2, name: null, schedule: DEFAULT_SCHEDULE, removed: false },
    ],
    sessions: Array.from({ length: n }, (_, i) => ({
      id: S(i),
      name: null,
      programId: P1,
      position: i,
      removed: false,
    })),
    slots: Array.from({ length: n }, (_, i) => slot(i, S(i))),
    ...patch,
  };
}

// Local times, so the suite reads the same days in any time zone.
export const local = (day: ISODate, hour: number, minute = 0) =>
  new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    hour,
    minute,
  ).toISOString();
let seq = 0;
export const did = (
  code: string,
  sessionId: string | null,
  day: ISODate,
  patch: Partial<Done> = {},
): Done => ({
  id: seedId(0xe000 + seq++),
  sessionCode: code,
  sessionId,
  startedAt: local(day, 18),
  endedAt: local(day, 19),
  removed: false,
  ...patch,
});
export const A = (day: ISODate, patch?: Partial<Done>) => did("A", S(0), day, patch);
export const B = (day: ISODate, patch?: Partial<Done>) => did("B", S(1), day, patch);
export const C = (day: ISODate, patch?: Partial<Done>) => did("C", S(2), day, patch);

export const plan = (p: StoredPrograms, workouts: Done[], today: ISODate) =>
  dayPlan(workouts, p, rotationOf(p), today);
export const codes = (week: readonly ({ code: string } | null)[] | null) =>
  week?.map((t) => t?.code ?? null) ?? null;
