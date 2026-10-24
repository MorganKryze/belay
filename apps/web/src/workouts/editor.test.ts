import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import type { Workout, WorkoutSet } from "@belay/shared/training/workout";
import { describe, expect, it } from "vitest";
import {
  addRow,
  editChanges,
  type EditRow,
  loggedTimes,
  movedTimes,
  parseRow,
  rowsOf,
} from "./editor";
import { loadNumber } from "@/lib/units";

const B = [...sessionByCode("B", starterProgram)!.slots];
const W = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const kgText = (kg: number) => String(kg);
const lbText = (kg: number) => loadNumber(kg, "en", "lb");
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const workout: Workout = {
  id: W,
  sessionCode: "B",
  plan: B,
  startedAt: local(5, 18).toISOString(),
  endedAt: local(5, 19, 10).toISOString(),
  note: null,
  exerciseNotes: {},
  removed: false,
};
const set = (n: number, position: number, patch: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${10 + n}`,
  workoutId: W,
  slotIndex: 0,
  position,
  exerciseId: "ds:0043",
  warmup: position < 3,
  weightKg: 100,
  reps: 8,
  seconds: null,
  rir: position < 3 ? null : 2,
  doneAt: workout.startedAt,
  removed: false,
  ...patch,
});
const SETS = [set(0, 0, { weightKg: 60, reps: 5 }), set(1, 3), set(2, 4, { reps: 7 })];
const NOW = local(7, 18);
const edit = (rows: EditRow[], patch: Partial<Parameters<typeof editChanges>[0]> = {}) =>
  editChanges({
    id: W,
    workout,
    sessionCode: "B",
    plan: B,
    date: "2026-10-05",
    minutes: 0,
    rows,
    now: NOW,
    ...patch,
  });

describe("a session's times (spec D9, D10)", () => {
  it("starts a session logged for an earlier day at noon, keeping its duration", () => {
    expect(loggedTimes("2026-10-05", 60, NOW)).toEqual({
      startedAt: local(5, 12).toISOString(),
      endedAt: local(5, 13).toISOString(),
    });
  });

  it("ends a session logged for this morning now, never after", () => {
    const morning = local(7, 9, 30);
    expect(loggedTimes("2026-10-07", 75, morning)).toEqual({
      startedAt: local(7, 8, 15).toISOString(),
      endedAt: morning.toISOString(),
    });
  });

  it("moves a session to another day at the same time, across a week, keeping its duration", () => {
    expect(movedTimes(workout, "2026-09-30", NOW)).toEqual({
      startedAt: new Date(2026, 8, 30, 18).toISOString(),
      endedAt: new Date(2026, 8, 30, 19, 10).toISOString(),
    });
  });

  it("moves a session to today ending now when its time is still ahead", () => {
    const morning = local(7, 9);
    expect(movedTimes(workout, "2026-10-07", morning)).toEqual({
      startedAt: local(7, 7, 50).toISOString(),
      endedAt: morning.toISOString(),
    });
  });
});

describe("the editor's rows", () => {
  it("adds a work set after the last one, from the row before it, never past 50 positions", () => {
    const rows = rowsOf(SETS, kgText);
    const added = addRow(rows, 0, B[0]!, { workouts: [], sets: [] }, "x", kgText)!;
    expect(added).toMatchObject({ position: 5, warmup: false, kg: "100", count: "7", set: null });
    const empty = addRow([], 1, B[1]!, { workouts: [], sets: [] }, "y", kgText)!;
    expect(empty).toMatchObject({ position: 3, kg: "", count: "" });
    const full = [{ ...rows[1]!, position: 49 }];
    expect(addRow(full, 0, B[0]!, { workouts: [], sets: [] }, "z", kgText)).toBeNull();
  });

  it("reads a row's cells: no load is none for a timed set, and only a work set in reps has a RIR", () => {
    const [warm, work] = rowsOf(SETS, kgText) as [EditRow, EditRow];
    expect(parseRow(work)).toEqual({ weightKg: 100, reps: 8, seconds: null, rir: 2 });
    expect(parseRow({ ...work, rir: "" })).toMatchObject({ rir: null });
    expect(parseRow({ ...work, kg: "100,1" })).toBeNull();
    expect(parseRow({ ...work, count: "8.5" })).toBeNull();
    expect(parseRow({ ...warm, rir: "1" })).toBeNull();
    const timed = { ...work, measure: "seconds" as const, kg: "", count: "45", rir: "" };
    expect(parseRow(timed)).toEqual({ weightKg: 0, reps: null, seconds: 45, rir: null });
    expect(parseRow({ ...timed, rir: "1" })).toBeNull();
    expect(parseRow({ ...timed, count: "3601" })).toBeNull();
  });
});

describe("what Save writes", () => {
  it("writes nothing when nothing changed", () => {
    expect(edit(rowsOf(SETS, kgText))).toEqual([]);
  });

  it("writes only the sets corrected, removed or added", () => {
    const rows = rowsOf(SETS, kgText);
    const added = addRow(
      rows,
      0,
      B[0]!,
      { workouts: [], sets: [] },
      "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e99",
      kgText,
    )!;
    const changes = edit([
      rows[0]!,
      { ...rows[1]!, kg: "102.5" },
      { ...rows[2]!, removed: true },
      added,
    ]);
    expect(changes).toEqual([
      expect.objectContaining({ kind: "set", id: rows[1]!.id, field: "values", weightKg: 102.5 }),
      expect.objectContaining({ kind: "set", id: rows[2]!.id, field: "removed", value: true }),
      expect.objectContaining({
        kind: "set",
        field: "create",
        position: 5,
        exerciseId: "ds:0043",
        doneAt: workout.endedAt,
      }),
    ]);
  });

  it("moves the session's day with its start and end, and keeps the plan it had", () => {
    const changes = edit(rowsOf(SETS, kgText), { date: "2026-09-30" });
    expect(changes).toEqual([
      expect.objectContaining({
        field: "startedAt",
        value: new Date(2026, 8, 30, 18).toISOString(),
      }),
      expect.objectContaining({
        field: "ended",
        value: new Date(2026, 8, 30, 19, 10).toISOString(),
      }),
    ]);
  });

  it("writes the plan with the exercise added", () => {
    const plan = [...B, { ...B[0]!, added: true as const }];
    expect(edit([], { plan })).toEqual([expect.objectContaining({ field: "plan", value: plan })]);
  });

  it("starts, fills and ends a session logged afterwards", () => {
    const row = addRow(
      [],
      0,
      B[0]!,
      { workouts: [], sets: [] },
      "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e98",
      kgText,
    )!;
    const changes = edit([{ ...row, kg: "100", count: "5" }], {
      workout: null,
      date: "2026-10-06",
      minutes: 60,
    })!;
    expect(changes.map((c) => ("field" in c ? c.field : c.kind))).toEqual([
      "start",
      "create",
      "ended",
    ]);
    expect(changes[0]).toMatchObject({ sessionCode: "B", startedAt: local(6, 12).toISOString() });
    expect(changes[2]).toMatchObject({ value: local(6, 13).toISOString() });
  });

  it("writes nothing at all while a row is incomplete", () => {
    const rows = rowsOf(SETS, kgText);
    expect(edit([{ ...rows[1]!, count: "" }])).toBeNull();
  });

  it("in pounds a typed 225 is saved as 102 kg", () => {
    const rows = rowsOf(SETS, lbText);
    expect(edit([rows[0]!, { ...rows[1]!, kg: "225" }, rows[2]!], { unit: "lb" })).toEqual([
      expect.objectContaining({ id: rows[1]!.id, field: "values", weightKg: 102 }),
    ]);
  });

  it("an unedited row in pounds is not a change", () => {
    const sets = SETS.map((s) => ({ ...s, weightKg: 61.25 }));
    expect(edit(rowsOf(sets, lbText), { unit: "lb" })).toEqual([]);
    const history = { workouts: [workout], sets };
    const added = addRow([], 0, B[0]!, history, "x", lbText)!;
    expect(added.kg).toBe("135");
    expect(edit([added], { unit: "lb" })).toEqual([
      expect.objectContaining({ field: "create", weightKg: 61.25 }),
    ]);
  });

  it("a lb row past 500 kg is refused", () => {
    const rows = rowsOf(SETS, lbText);
    expect(edit([{ ...rows[1]!, kg: "1105" }], { unit: "lb" })).toBeNull();
    expect(edit([{ ...rows[1]!, kg: "1100" }], { unit: "lb" })).not.toBeNull();
  });
});
