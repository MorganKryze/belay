import { describe, expect, it } from "vitest";
import { addDays, type ISODate } from "../body/dates";
import {
  dayPlan,
  daysOf,
  type Done,
  fixedWeek,
  plannedNext,
  proposeWeek,
  sessionDays,
  STARTING_DAYS,
  weekdayOf,
  weekOrder,
} from "./schedule";
import {
  DEFAULT_SCHEDULE,
  isSchedule,
  nextInRotation,
  type ProgramSlot,
  rotationOf,
  type Schedule,
  seedId,
  type StoredPrograms,
} from "./stored-program";

const P1 = seedId(0xa01);
const P2 = seedId(0xa02);
const S = (i: number) => seedId(0xb00 + i);
const UNKNOWN = seedId(0xfff);

// The week of 2026-10-19; Paris leaves summer time on Sunday 25.
const MON = "2026-10-19";
const TUE = "2026-10-20";
const WED = "2026-10-21";
const THU = "2026-10-22";
const SAT = "2026-10-24";
const SUN = "2026-10-25";
const NEXT_MON = "2026-10-26";

const fixed = (days: (string | null)[]): Schedule => ({ mode: "fixed", days });
// Monday A, Wednesday B, Saturday C.
const MWS = fixed([S(0), null, S(1), null, null, S(2), null]);
// Monday A alone.
const MONDAYS = fixed([S(0), null, null, null, null, null, null]);

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
function stored(
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
const local = (day: ISODate, hour: number, minute = 0) =>
  new Date(
    Number(day.slice(0, 4)),
    Number(day.slice(5, 7)) - 1,
    Number(day.slice(8, 10)),
    hour,
    minute,
  ).toISOString();
let seq = 0;
const did = (
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
const A = (day: ISODate, patch?: Partial<Done>) => did("A", S(0), day, patch);
const B = (day: ISODate, patch?: Partial<Done>) => did("B", S(1), day, patch);
const C = (day: ISODate, patch?: Partial<Done>) => did("C", S(2), day, patch);

const plan = (p: StoredPrograms, workouts: Done[], today: ISODate) =>
  dayPlan(workouts, p, rotationOf(p), today);
const codes = (week: readonly ({ code: string } | null)[] | null) =>
  week?.map((t) => t?.code ?? null) ?? null;

describe("weekdays", () => {
  it("weekdayOf gives Monday 0 and Sunday 6, across a daylight-saving change", () => {
    expect([MON, TUE, WED, THU, SAT, SUN, NEXT_MON].map(weekdayOf)).toEqual([0, 1, 2, 3, 5, 6, 0]);
    expect(weekdayOf(addDays(SAT, 1))).toBe(6);
    expect(weekdayOf(addDays(SUN, 1))).toBe(0);
    expect(weekdayOf("2026-03-29")).toBe(6);
    expect(weekdayOf("2027-01-01")).toBe(4);
  });
});

describe("the fixed week", () => {
  it("a rotation program has no fixed week", () => {
    const p = stored(3, { mode: "rotation", days: MWS.days });
    expect(fixedWeek(p, rotationOf(p))).toBeNull();
    expect(plan(p, [A(MON)], WED)).toEqual({ kind: "rotation", next: rotationOf(p)[1] });
  });

  it("a fixed week maps ids to rotation sessions, a set-aside, removed, emptied or unknown id to a rest day", () => {
    const base = stored(7);
    const p = stored(7, fixed([S(0), S(2), S(3), S(4), S(5), S(1), UNKNOWN]), {
      sessions: base.sessions.map((s) =>
        s.id === S(2)
          ? { ...s, programId: null }
          : s.id === S(3)
            ? { ...s, removed: true }
            : s.id === S(5)
              ? { ...s, programId: P2 }
              : s,
      ),
      slots: base.slots.filter((s) => s.sessionId !== S(4)),
    });
    const week = fixedWeek(p, rotationOf(p));
    expect(codes(week)).toEqual(["A", null, null, null, null, "B", null]);
    expect(week?.[0]?.sessionId).toBe(S(0));
    expect(plan(p, [], TUE)).toMatchObject({ kind: "rest", next: { day: SAT } });
  });

  it("a fixed week with no session day reads as rotation", () => {
    const base = stored(3);
    const p = stored(3, fixed([S(2), null, UNKNOWN, null, null, null, null]), {
      sessions: base.sessions.map((s) => (s.id === S(2) ? { ...s, programId: null } : s)),
    });
    const rotation = rotationOf(p);
    expect(fixedWeek(p, rotation)).toBeNull();
    expect(plan(p, [A(MON)], WED)).toEqual({ kind: "rotation", next: rotation[1] });
    expect(fixedWeek(stored(3, fixed(Array(7).fill(null))), rotation)).toBeNull();
  });

  it("an inactive or removed program has no fixed week", () => {
    const p = stored(3, MWS);
    expect(fixedWeek({ ...p, activeId: P2 }, rotationOf(p))).toBeNull();
    const removed = { ...p, programs: p.programs.map((x) => ({ ...x, removed: true })) };
    expect(fixedWeek(removed, rotationOf(p))).toBeNull();
  });

  it("a reorder changes letters, never days", () => {
    const base = stored(3, MWS);
    const p = {
      ...base,
      sessions: base.sessions.map((s) =>
        s.id === S(0) ? { ...s, position: 1 } : s.id === S(1) ? { ...s, position: 0 } : s,
      ),
    };
    const week = fixedWeek(p, rotationOf(p));
    expect(codes(week)).toEqual(["B", null, "A", null, null, "C", null]);
    expect(week?.[0]?.sessionId).toBe(S(0));
  });

  it("sessionDays and daysOf", () => {
    const p = stored(4, fixed([S(0), null, S(1), S(0), null, S(2), null]));
    const week = fixedWeek(p, rotationOf(p))!;
    expect(sessionDays(week)).toBe(4);
    expect(daysOf(week, S(0))).toEqual([0, 3]);
    expect(daysOf(week, S(1))).toEqual([2]);
    expect(daysOf(week, S(3))).toEqual([]);
  });
});

describe("today's plan on fixed days", () => {
  const p = stored(3, MWS);

  it("today due: today's session and the next session day", () => {
    expect(plan(p, [], WED)).toMatchObject({
      kind: "due",
      session: { code: "B", sessionId: S(1) },
      next: { session: { code: "C" }, day: SAT },
    });
  });

  it("done the day before, after the previous session day: done yesterday", () => {
    const early = B(TUE);
    expect(plan(p, [A(MON), early], WED)).toEqual({
      kind: "done",
      session: rotationOf(p)[1],
      workout: early,
      on: TUE,
      next: { session: rotationOf(p)[2], day: SAT },
    });
  });

  it("done today: the latest finished and kept one", () => {
    const first = B(WED, { startedAt: local(WED, 8), endedAt: local(WED, 9) });
    const last = B(WED);
    const open = B(WED, { startedAt: local(WED, 20), endedAt: null });
    const removed = B(WED, { startedAt: local(WED, 21), removed: true });
    expect(plan(p, [last, first, open, removed], WED)).toMatchObject({
      kind: "done",
      workout: last,
      on: WED,
      next: { day: SAT },
    });
    expect(plan(p, [open, removed], WED)).toMatchObject({ kind: "due" });
  });

  it("done on the previous session day itself does not count", () => {
    expect(plan(p, [B(MON)], WED)).toMatchObject({ kind: "due", session: { code: "B" } });
  });

  it("another session done in the window does not make today's done", () => {
    expect(plan(p, [A(TUE), C(TUE)], WED)).toMatchObject({ kind: "due", session: { code: "B" } });
  });

  it("a session done after today does not count", () => {
    expect(plan(p, [B(THU)], WED)).toMatchObject({ kind: "due" });
  });

  it("a week with one session day: the window is the last 7 days", () => {
    const one = stored(3, MONDAYS);
    expect(plan(one, [A(TUE)], NEXT_MON)).toMatchObject({ kind: "done", on: TUE });
    expect(plan(one, [A(MON)], NEXT_MON)).toMatchObject({
      kind: "due",
      session: { code: "A" },
      next: { day: "2026-11-02" },
    });
    // Started late on the Sunday Paris leaves summer time: still that Sunday.
    const late = A(SUN, { startedAt: local(SUN, 23, 30), endedAt: local(NEXT_MON, 0, 30) });
    expect(plan(one, [A(MON), late], NEXT_MON)).toMatchObject({ kind: "done", on: SUN });
  });

  it("a rest day gives the next session day, 1 to 6 days on, or 7 when today's session was today's only day", () => {
    expect(plan(p, [], TUE)).toEqual({
      kind: "rest",
      next: { session: rotationOf(p)[1], day: WED },
    });
    expect(plan(p, [], SUN)).toMatchObject({
      kind: "rest",
      next: { session: { code: "A" }, day: NEXT_MON },
    });
    const one = stored(3, MONDAYS);
    expect(plan(one, [], TUE)).toMatchObject({ kind: "rest", next: { day: NEXT_MON } });
    expect(plan(one, [], MON)).toMatchObject({
      kind: "due",
      next: { session: { code: "A" }, day: NEXT_MON },
    });
    expect(plan(one, [A(MON)], MON)).toMatchObject({ kind: "done", next: { day: NEXT_MON } });
  });

  it("a letter-only session counts only since activation", () => {
    const byLetter = did("B", null, TUE);
    expect(plan(p, [byLetter], WED)).toMatchObject({ kind: "done", workout: byLetter });
    const after = { ...p, activeAt: local(TUE, 19) };
    expect(plan(after, [byLetter], WED)).toMatchObject({ kind: "due" });
    const before = { ...p, activeAt: local(TUE, 12) };
    expect(plan(before, [byLetter], WED)).toMatchObject({ kind: "done", workout: byLetter });
    // A recorded session counts whenever it was started.
    expect(plan(after, [B(TUE)], WED)).toMatchObject({ kind: "done" });
    // A letter names another session elsewhere: C's letter is not B.
    expect(plan(p, [did("C", null, TUE)], WED)).toMatchObject({ kind: "due" });
  });
});

describe("the next session", () => {
  it("plannedNext in rotation is nextInRotation's", () => {
    const p = stored(3);
    const rotation = rotationOf(p);
    const history = [A(MON), B(TUE)];
    expect(plannedNext(history, p, rotation, WED)).toBe(nextInRotation(history, rotation, null));
    expect(plannedNext(history, p, rotation, WED)?.code).toBe("C");
    expect(plannedNext([], stored(0), [], WED)).toBeNull();
  });

  it("plannedNext on fixed days: today's while due, else the next day's", () => {
    const p = stored(3, MWS);
    const rotation = rotationOf(p);
    expect(plannedNext([], p, rotation, WED)?.code).toBe("B");
    expect(plannedNext([B(WED)], p, rotation, WED)?.code).toBe("C");
    expect(plannedNext([], p, rotation, TUE)?.code).toBe("B");
    expect(plannedNext([], p, rotation, SUN)?.code).toBe("A");
  });
});

describe("the week's order", () => {
  // Monday A, Wednesday B, Thursday A, Saturday C; D has no day.
  const p = stored(4, fixed([S(0), null, S(1), S(0), null, S(2), null]));
  const rotation = rotationOf(p);
  const order = (workouts: Done[], today: ISODate) =>
    weekOrder(workouts, p, rotation, today)?.map((c) => [c.session.code, c.next, c.days]);

  it("weekOrder puts the next first, then by day, sessions with no day last, a session with two days once", () => {
    expect(order([], TUE)).toEqual([
      ["B", WED, [2]],
      ["A", THU, [0, 3]],
      ["C", SAT, [5]],
      ["D", null, []],
    ]);
    expect(order([B(WED)], WED)).toEqual([
      ["A", THU, [0, 3]],
      ["C", SAT, [5]],
      ["B", "2026-10-28", [2]],
      ["D", null, []],
    ]);
    expect(order([], WED)?.[0]).toEqual(["B", WED, [2]]);
    expect(weekOrder([], stored(4), rotationOf(stored(4)), TUE)).toBeNull();
  });

  it("weekOrder's first is plannedNext's on every day, done or not", () => {
    const week = Array.from({ length: 7 }, (_, i) => addDays(MON, i));
    for (const today of week)
      for (const workouts of [[], [A(today)], [B(today)], [C(today)]]) {
        const first = weekOrder(workouts, p, rotation, today)?.[0]?.session;
        expect(first).toBe(plannedNext(workouts, p, rotation, today));
      }
  });
});

describe("a proposed week", () => {
  const today = NEXT_MON; // the last 4 weeks: 2026-09-28 to 2026-10-25

  it("proposeWeek learns a weekday seen in 2 of the last 4 weeks, ties to the earlier letter, ignores older and removed sessions", () => {
    const rotation = rotationOf(stored(3));
    const history = [
      // Monday: A in two weeks.
      A("2026-10-05"),
      A("2026-10-12"),
      // Wednesday: B and C two weeks each, B wins.
      C("2026-09-30"),
      B("2026-10-07"),
      B("2026-10-14"),
      C("2026-10-21"),
      // Thursday: A twice in one week only.
      A(THU),
      A(THU, { startedAt: local(THU, 7) }),
      // Saturday: B once in the window, twice before it.
      B("2026-09-19"),
      B("2026-09-26"),
      B(SAT),
      // Sunday: C once kept, once removed, once unfinished.
      C("2026-10-11"),
      C("2026-10-18", { removed: true }),
      C(SUN, { endedAt: null }),
      // Today does not count yet.
      C(today),
      C("2026-10-19"),
    ];
    expect(proposeWeek(history, rotation, today, null)).toEqual({
      days: [S(0), null, S(1), null, null, null, null],
      learned: true,
    });
  });

  it("proposeWeek counts letter-only sessions from activation", () => {
    const rotation = rotationOf(stored(3));
    const history = [did("C", null, "2026-10-06"), did("C", null, "2026-10-13")];
    expect(proposeWeek(history, rotation, today, null).days[1]).toBe(S(2));
    expect(proposeWeek(history, rotation, today, local("2026-10-10", 12))).toEqual({
      days: [S(0), null, S(1), null, S(2), null, null],
      learned: false,
    });
  });

  it("proposeWeek without history uses the starting pattern for 1 to 9 sessions", () => {
    const of = (n: number) => {
      const rotation = rotationOf(stored(n));
      const { days, learned } = proposeWeek([], rotation, today, null);
      expect(learned).toBe(false);
      return days.map((id) => rotation.find((t) => t.sessionId === id)?.code ?? null);
    };
    const _ = null;
    expect(of(1)).toEqual(["A", _, _, _, _, _, _]);
    expect(of(2)).toEqual(["A", _, _, "B", _, _, _]);
    expect(of(3)).toEqual(["A", _, "B", _, "C", _, _]);
    expect(of(4)).toEqual(["A", "B", _, "C", "D", _, _]);
    expect(of(5)).toEqual(["A", "B", "C", _, "D", "E", _]);
    expect(of(6)).toEqual(["A", "B", "C", "D", "E", "F", _]);
    expect(of(7)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(of(9)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    expect(proposeWeek([A(MON)], [], today, null)).toEqual({
      days: Array(7).fill(null),
      learned: false,
    });
    expect(STARTING_DAYS.map((d) => d.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("every day of a proposal is null or a rotation session id and the schedule passes isSchedule", () => {
    const history = [A("2026-10-05"), A("2026-10-12"), B("2026-10-07"), B("2026-10-14")];
    for (const n of [0, 1, 3, 5, 8]) {
      const rotation = rotationOf(stored(n));
      const ids = new Set(rotation.map((t) => t.sessionId));
      for (const workouts of [[], history]) {
        const { days } = proposeWeek(workouts, rotation, today, null);
        expect(days).toHaveLength(7);
        expect(days.every((d) => d === null || ids.has(d))).toBe(true);
        expect(isSchedule({ mode: "fixed", days })).toBe(true);
      }
    }
  });
});
