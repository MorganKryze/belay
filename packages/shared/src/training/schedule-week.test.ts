import { describe, expect, it } from "vitest";
import { addDays, type ISODate } from "../body/dates";
import { type Done, plannedNext } from "./schedule";
import {
  A,
  B,
  C,
  did,
  fixed,
  local,
  MON,
  NEXT_MON,
  S,
  SAT,
  stored,
  SUN,
  THU,
  TUE,
  WED,
} from "./schedule-fixtures";
import { proposeWeek, STARTING_DAYS, weekOrder } from "./schedule-week";
import { isSchedule, rotationOf } from "./stored-program";

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
