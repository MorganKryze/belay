import { describe, expect, it } from "vitest";
import { addDays } from "../body/dates";
import { daysOf, fixedWeek, plannedNext, sessionDays, weekdayOf } from "./schedule";
import {
  A,
  B,
  C,
  codes,
  did,
  fixed,
  local,
  MON,
  MONDAYS,
  MWS,
  NEXT_MON,
  P2,
  plan,
  S,
  SAT,
  stored,
  SUN,
  THU,
  TUE,
  UNKNOWN,
  WED,
} from "./schedule-fixtures";
import { nextInRotation, rotationOf } from "./stored-program";

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
