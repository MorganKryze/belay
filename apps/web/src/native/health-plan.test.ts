import type { SetRow, WeightRow, WorkoutRow } from "@belay/shared/sync/schema";
import { describe, expect, it } from "vitest";
import { HEALTH_OFF, type HealthSettings, type Written } from "./health";
import {
  afterOutcome,
  finishedSpan,
  type HealthPlanInput,
  historyCounts,
  ownerOf,
  planHealth,
  sampleTime,
  sessionKey,
  versionOf,
  weighingKey,
} from "./health-plan";

// The phone's local time throughout, as the app reads it.
const ON = new Date(2026, 9, 20, 12, 0).getTime();
const NOW = new Date(2026, 9, 26, 12, 0).getTime();
const iso = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).toISOString();
const W1 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01";
const W2 = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d02";

function workout(
  id: string,
  start: string,
  end: string | null,
  extra: Partial<WorkoutRow> = {},
): WorkoutRow {
  return {
    id,
    sessionCode: "A",
    plan: [],
    planAt: null,
    startedAt: start,
    startedAtAt: null,
    endedAt: end,
    endedAtAt: end,
    note: null,
    noteAt: null,
    exerciseNotes: {},
    exerciseNotesAt: null,
    removed: false,
    removedAt: null,
    ...extra,
  };
}
const set = (workoutId: string, n: number, removed = false): SetRow => ({
  id: `${workoutId.slice(0, -2)}9${n}`,
  workoutId,
  slotIndex: 0,
  position: 3 + n,
  exerciseId: "ds:0025",
  warmup: false,
  weightKg: 80,
  reps: 8,
  seconds: null,
  rir: 1,
  doneAt: iso(2026, 10, 24, 18, 5),
  fieldsAt: iso(2026, 10, 24, 18, 5),
  removed,
  removedAt: removed ? iso(2026, 10, 24, 19) : null,
});
const weight = (
  date: string,
  weightKg: number | null,
  at = `${date}T06:00:00.000Z`,
): WeightRow => ({
  date,
  weightKg,
  at,
});
const SETTINGS: HealthSettings = { ...HEALTH_OFF, on: true, turnedOnAt: ON };
const OWNER = "0a1b2c3d";

const input = (over: Partial<HealthPlanInput> = {}): HealthPlanInput => ({
  workouts: [],
  sets: [],
  weights: [],
  settings: SETTINGS,
  written: {},
  filled: {},
  allowed: { workouts: true, weighings: true },
  now: NOW,
  owner: OWNER,
  ...over,
});
// A session on the 24th, 18:00 to 19:00, with one set.
const DONE = workout(W1, iso(2026, 10, 24, 18), iso(2026, 10, 24, 19));
const SPAN = { startedAt: Date.parse(DONE.startedAt), endedAt: Date.parse(DONE.endedAt!) };

describe("which sessions Health holds", () => {
  it("a session finished after the setting went on is written with its start, end and a version", () => {
    expect(planHealth(input({ workouts: [DONE], sets: [set(W1, 0)] }))).toEqual([
      { kind: "workout", id: W1, ...SPAN, version: SPAN.endedAt },
    ]);
  });

  it("a session in progress, removed, without a set or ending at its start is not one", () => {
    expect(finishedSpan(workout(W1, iso(2026, 10, 24, 18), null), 1)).toBeNull();
    expect(finishedSpan({ ...DONE, removed: true }, 1)).toBeNull();
    expect(finishedSpan(DONE, 0)).toBeNull();
    expect(finishedSpan(workout(W1, iso(2026, 10, 24, 18), iso(2026, 10, 24, 18)), 1)).toBeNull();
    expect(planHealth(input({ workouts: [DONE], sets: [set(W1, 0, true)] }))).toEqual([]);
  });

  it("a session that ended before the setting went on waits for the history action", () => {
    const old = workout(W2, iso(2026, 10, 2, 18), iso(2026, 10, 2, 19));
    const data = { workouts: [old], sets: [set(W2, 0)] };
    expect(planHealth(input(data))).toEqual([]);
    expect(
      planHealth(input({ ...data, settings: { ...SETTINGS, history: "asked" } })),
    ).toHaveLength(1);
  });

  it("a session Health holds at its times is not sent again", () => {
    const written = { [sessionKey(W1)]: { state: "workout", version: 5, ...SPAN } as Written };
    expect(planHealth(input({ workouts: [DONE], sets: [set(W1, 0)], written }))).toEqual([]);
  });

  it("a new end is sent again with a greater version, even from before the setting went on", () => {
    const moved = {
      ...DONE,
      endedAt: iso(2026, 10, 24, 19, 30),
      endedAtAt: iso(2026, 10, 24, 19, 31),
    };
    const written = { [sessionKey(W1)]: { state: "workout", version: 9e12, ...SPAN } as Written };
    const [o] = planHealth(
      input({
        workouts: [moved],
        sets: [set(W1, 0)],
        written,
        settings: { ...SETTINGS, turnedOnAt: NOW },
      }),
    );
    expect(o).toMatchObject({
      kind: "workout",
      id: W1,
      endedAt: Date.parse(moved.endedAt),
      version: 9e12 + 1,
    });
  });

  it("a written session removed, emptied or reopened is removed from Health, and written again once finished", () => {
    const written = { [sessionKey(W1)]: { state: "workout", version: 5, ...SPAN } as Written };
    const removed = { kind: "workoutRemoved", id: W1 };
    expect(
      planHealth(input({ workouts: [{ ...DONE, removed: true }], sets: [set(W1, 0)], written })),
    ).toEqual([removed]);
    expect(planHealth(input({ workouts: [DONE], sets: [set(W1, 0, true)], written }))).toEqual([
      removed,
    ]);
    expect(
      planHealth(input({ workouts: [{ ...DONE, endedAt: null }], sets: [set(W1, 0)], written })),
    ).toEqual([removed]);
    const gone = { [sessionKey(W1)]: { state: "removed", version: 5 } as Written };
    expect(planHealth(input({ workouts: [DONE], sets: [set(W1, 0)], written: gone }))).toEqual([
      { kind: "workout", id: W1, ...SPAN, version: SPAN.endedAt },
    ]);
  });

  it("a session skipped for another app's workout is looked at again only when its times change", () => {
    const written = { [sessionKey(W1)]: { state: "skipped", version: 0, ...SPAN } as Written };
    expect(planHealth(input({ workouts: [DONE], sets: [set(W1, 0)], written }))).toEqual([]);
    const later = { ...DONE, endedAt: iso(2026, 10, 24, 19, 10) };
    expect(planHealth(input({ workouts: [later], sets: [set(W1, 0)], written }))).toHaveLength(1);
  });

  it("a session Health would refuse is left out, and one it holds is removed from it", () => {
    const all = { ...SETTINGS, history: "asked" } as const;
    const plan = (w: WorkoutRow, written: Record<string, Written> = {}) =>
      planHealth(input({ workouts: [w], sets: [set(W1, 0)], settings: all, written }));
    // Exactly a day is the longest workout Health takes.
    expect(plan(workout(W1, iso(2026, 10, 23, 18), iso(2026, 10, 24, 18)))).toHaveLength(1);
    expect(plan(workout(W1, iso(2026, 10, 23, 18), iso(2026, 10, 24, 18, 1)))).toEqual([]);
    // Before 1899-12-31 in UTC, or ending more than a day after the phone's clock.
    expect(plan(workout(W1, "1899-12-30T23:00:00.000Z", "1899-12-31T01:00:00.000Z"))).toEqual([]);
    expect(plan(workout(W1, "1899-12-31T00:00:00.000Z", "1899-12-31T01:00:00.000Z"))).toHaveLength(
      1,
    );
    const ahead = new Date(NOW + 86_400_000 + 60_000).toISOString();
    expect(plan(workout(W1, new Date(NOW).toISOString(), ahead))).toEqual([]);
    const written = { [sessionKey(W1)]: { state: "workout", version: 5, ...SPAN } as Written };
    expect(plan({ ...DONE, endedAt: iso(2026, 10, 26, 19) }, written)).toEqual([
      { kind: "workoutRemoved", id: W1 },
    ]);
  });

  it("a session ahead of the phone's clock waits, and one Health holds stays there", () => {
    const all = { ...SETTINGS, history: "asked" } as const;
    const written = { [sessionKey(W1)]: { state: "workout", version: 5, ...SPAN } as Written };
    // The phone's clock set back two days: the session, edited since, now ends in its future.
    const moved = { ...DONE, endedAt: iso(2026, 10, 24, 19, 30) };
    const now = SPAN.endedAt - 2 * 86_400_000;
    const plan = (w: WorkoutRow) =>
      planHealth(input({ workouts: [w], sets: [set(W1, 0)], settings: all, written, now }));
    expect(plan(moved)).toEqual([]);
    expect(plan(DONE)).toEqual([]);
    // Back on time, the edit goes.
    expect(
      planHealth(input({ workouts: [moved], sets: [set(W1, 0)], settings: all, written })),
    ).toHaveLength(1);
  });

  it("nothing is planned while the setting is off, and a refused type is left out", () => {
    const data = { workouts: [DONE], sets: [set(W1, 0)], weights: [weight("2026-10-25", 80.4)] };
    expect(planHealth(input({ ...data, settings: { ...SETTINGS, on: false } }))).toEqual([]);
    expect(
      planHealth(input({ ...data, allowed: { workouts: false, weighings: true } })).map(
        (o) => o.kind,
      ),
    ).toEqual(["weighing"]);
    expect(
      planHealth(input({ ...data, allowed: { workouts: true, weighings: false } })).map(
        (o) => o.kind,
      ),
    ).toEqual(["workout"]);
  });
});

describe("which weigh-ins Health holds", () => {
  it("a weigh-in from the setting's day on is written at 08:00 with its time as version", () => {
    expect(planHealth(input({ weights: [weight("2026-10-20", 80.4)] }))).toEqual([
      {
        kind: "weighing",
        owner: OWNER,
        date: "2026-10-20",
        kg: 80.4,
        at: new Date(2026, 9, 20, 8).getTime(),
        version: Date.parse("2026-10-20T06:00:00.000Z"),
      },
    ]);
    expect(planHealth(input({ weights: [weight("2026-10-19", 80.4)] }))).toEqual([]);
  });

  it("today's weigh-in before 08:00 is timed now, never in the future", () => {
    const early = new Date(2026, 9, 26, 7, 12).getTime();
    expect(sampleTime("2026-10-26", early)).toBe(early);
    expect(sampleTime("2026-10-25", early)).toBe(new Date(2026, 9, 25, 8).getTime());
  });

  it("a new value is sent again with a greater version; a deleted day is removed", () => {
    const written = {
      [weighingKey("2026-10-25")]: { state: "weighing", version: 7, kg: 80.4 } as Written,
    };
    expect(planHealth(input({ weights: [weight("2026-10-25", 80.4)], written }))).toEqual([]);
    expect(
      planHealth(
        input({ weights: [weight("2026-10-25", 80.1, "1970-01-01T00:00:00.000Z")], written }),
      ),
    ).toEqual([expect.objectContaining({ kind: "weighing", kg: 80.1, version: 8 })]);
    expect(planHealth(input({ weights: [weight("2026-10-25", null)], written }))).toEqual([
      { kind: "weighingRemoved", owner: OWNER, date: "2026-10-25" },
    ]);
  });

  it("a weigh-in Health would refuse is left out, and one it holds is removed from it", () => {
    const all = { ...SETTINGS, history: "asked" } as const;
    const plan = (rows: WeightRow[], written: Record<string, Written> = {}) =>
      planHealth(input({ weights: rows, settings: all, written }));
    expect(plan([weight("2026-10-25", 20), weight("2026-10-24", 400)])).toHaveLength(2);
    expect(plan([weight("2026-10-25", 19.9), weight("2026-10-24", 400.1)])).toEqual([]);
    // 08:00 on that day is before 1899-12-31 in UTC in every time zone.
    expect(plan([weight("1899-12-29", 80)])).toEqual([]);
    const written = {
      [weighingKey("2026-10-25")]: { state: "weighing", version: 7, kg: 80.4 } as Written,
    };
    expect(plan([weight("2026-10-25", 401)], written)).toEqual([
      { kind: "weighingRemoved", owner: OWNER, date: "2026-10-25" },
    ]);
  });

  it("two accounts, or one account on two instances, write a day under distinct identifiers", () => {
    const a = ownerOf("belay.0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01@https://belay.example");
    const b = ownerOf("belay.0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d02@https://belay.example");
    const elsewhere = ownerOf("belay.0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01@https://gym.example");
    for (const owner of [a, b, elsewhere]) expect(owner).toMatch(/^[0-9a-f]{8}$/);
    expect(new Set([a, b, elsewhere]).size).toBe(3);
    // Stable across launches: the same name always gives the same tag.
    expect(ownerOf("belay.user-a")).toBe(ownerOf("belay.user-a"));
    const day = (owner: string) =>
      planHealth(input({ weights: [weight("2026-10-25", 80.4)], owner }))[0];
    expect(day(a)).toMatchObject({ kind: "weighing", owner: a, date: "2026-10-25" });
    expect(day(b)).toMatchObject({ kind: "weighing", owner: b, date: "2026-10-25" });
  });

  it("a day the import filled is never written back, even edited", () => {
    const filled = { "2026-10-25": { at: "x", startedAt: 0 } };
    expect(planHealth(input({ weights: [weight("2026-10-25", 81)], filled }))).toEqual([]);
  });
});

describe("versions and outcomes", () => {
  it("a version is the latest time written, or one above the last one this phone wrote", () => {
    expect(versionOf(1000, undefined)).toBe(1000);
    expect(versionOf(1000, 2000)).toBe(2001);
  });

  it("only what Health confirmed is recorded; the rest stays pending", () => {
    const w = { kind: "workout", id: W1, ...SPAN, version: 3 } as const;
    expect(afterOutcome(w, "written", undefined)).toEqual({
      state: "workout",
      version: 3,
      ...SPAN,
    });
    expect(afterOutcome(w, "overlap", undefined)).toEqual({
      state: "skipped",
      version: 0,
      ...SPAN,
    });
    expect(
      afterOutcome({ kind: "workoutRemoved", id: W1 }, "removed", {
        state: "workout",
        version: 3,
        ...SPAN,
      }),
    ).toEqual({ state: "removed", version: 3 });
    for (const outcome of ["denied", "unavailable", "failed"] as const)
      expect(afterOutcome(w, outcome, undefined)).toBeNull();
  });

  it("the history counts what it would add from before the setting went on", () => {
    const old = workout(W2, iso(2026, 10, 2, 18), iso(2026, 10, 2, 19));
    expect(
      historyCounts({
        workouts: [old, DONE],
        sets: [set(W2, 0), set(W1, 0)],
        weights: [weight("2026-10-01", 81), weight("2026-10-21", 80)],
        settings: SETTINGS,
        written: {},
        filled: {},
      }),
    ).toEqual({ sessions: 1, weighings: 1 });
  });
});
