import { describe, expect, it } from "vitest";
import { isNewer } from "../sync/merge";
import { isValidChange } from "../sync/valid";
import {
  addSession,
  addSlot,
  chooseActive,
  createProgram,
  editSlot,
  placeSession,
  removeSession,
  removeSlot,
  renameProgram,
  renameSession,
  replaceExercise,
  setSchedule,
} from "./program-edits";
import { type ProgramEdit, undoOf } from "./program-undo";
import {
  DEFAULT_SCHEDULE,
  type Program,
  type ProgramSession,
  type ProgramSlot,
  SEED,
  SEED_PROGRAM_ID,
  seedId,
  type StoredPrograms,
  withSeed,
} from "./stored-program";

const AT = "2026-10-25T08:00:00.000Z";
const UNDO = "2026-10-25T08:05:00.000Z";
const [A, B, C] = SEED.sessions.map((s) => s.id) as [string, string, string];
const BENCH = seedId(0x101); // session A's first slot: counted in repetitions, with warm-ups
const P2 = seedId(0xa02);
const P3 = seedId(0xa03);
const NEW = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d95";
const NEW_SLOT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d96";
const PLANK = { id: "ds:2135", measure: "seconds" } as const;

const program = (id: string): Program => ({
  id,
  name: null,
  schedule: DEFAULT_SCHEDULE,
  removed: false,
});
// The starting program plus two empty ones, P2 and P3.
const before: StoredPrograms = withSeed({ programs: [program(P2), program(P3)] });
const bench = before.slots.find((s) => s.id === BENCH)!;

// The stored programs with one row's values replaced, as another write would leave them.
const withProgram = (p: StoredPrograms, id: string, values: Partial<Program>): StoredPrograms => ({
  ...p,
  programs: p.programs.map((r) => (r.id === id ? { ...r, ...values } : r)),
});
const withSession = (
  p: StoredPrograms,
  id: string,
  values: Partial<ProgramSession>,
): StoredPrograms => ({
  ...p,
  sessions: p.sessions.map((r) => (r.id === id ? { ...r, ...values } : r)),
});
const withSlot = (p: StoredPrograms, id: string, values: Partial<ProgramSlot>): StoredPrograms => ({
  ...p,
  slots: p.slots.map((r) => (r.id === id ? { ...r, ...values } : r)),
});

describe("undoOf", () => {
  it("undoing a value edit writes the previous value", () => {
    const edit: ProgramEdit[] = [
      ...editSlot(before, BENCH, { field: "sets", value: 5 }, AT)!,
      ...editSlot(before, BENCH, { field: "rir", value: [0, 1] }, AT)!,
      ...editSlot(before, BENCH, { field: "rest", value: 240 }, AT)!,
      ...editSlot(before, BENCH, { field: "main", value: !bench.isMain }, AT)!,
      ...editSlot(before, BENCH, { field: "rule", value: "no_climbing" }, AT)!,
      ...renameProgram(P2, "Été", AT),
      ...setSchedule(P2, { mode: "fixed", days: [A, null, B, null, C, null, null] }, AT),
      ...renameSession(A, "Haut", AT),
    ];
    let now = withSlot(before, BENCH, {
      sets: 5,
      // Another array than the one the edit wrote: compared by value.
      rirTarget: [0, 1],
      restSec: 240,
      isMain: !bench.isMain,
      rule: "no_climbing",
    });
    now = withProgram(now, P2, {
      name: "Été",
      schedule: { mode: "fixed", days: [A, null, B, null, C, null, null] },
    });
    now = withSession(now, A, { name: "Haut" });
    expect(undoOf(before, edit, now, UNDO)).toEqual([
      { kind: "programSession", id: A, field: "name", value: null, at: UNDO },
      { kind: "program", id: P2, field: "schedule", value: DEFAULT_SCHEDULE, at: UNDO },
      { kind: "program", id: P2, field: "name", value: null, at: UNDO },
      { kind: "programSlot", id: BENCH, field: "rule", value: null, at: UNDO },
      { kind: "programSlot", id: BENCH, field: "main", value: bench.isMain, at: UNDO },
      { kind: "programSlot", id: BENCH, field: "rest", value: bench.restSec, at: UNDO },
      { kind: "programSlot", id: BENCH, field: "rir", value: bench.rirTarget, at: UNDO },
      { kind: "programSlot", id: BENCH, field: "sets", value: bench.sets, at: UNDO },
    ]);
  });

  it("a value changed since by another device is left alone", () => {
    const edit: ProgramEdit[] = [
      ...editSlot(before, BENCH, { field: "sets", value: 5 }, AT)!,
      ...editSlot(before, BENCH, { field: "rir", value: [0, 1] }, AT)!,
      ...editSlot(before, BENCH, { field: "rest", value: 240 }, AT)!,
      ...renameProgram(P2, "Été", AT),
      ...renameSession(A, "Haut", AT),
    ];
    let now = withSlot(before, BENCH, { sets: 6, rirTarget: [0, 2], restSec: 240 });
    now = withProgram(now, P2, { name: "Hiver" });
    now = withSession(now, A, { name: "Bas" });
    expect(undoOf(before, edit, now, UNDO)).toEqual([
      { kind: "programSlot", id: BENCH, field: "rest", value: bench.restSec, at: UNDO },
    ]);
    // Removed since: the removal stays, and a value under it is still put back.
    const removed = withSlot(withSlot(before, BENCH, { sets: 5 }), BENCH, { removed: true });
    expect(
      undoOf(before, [...edit.slice(0, 1), ...removeSlot(NEW_SLOT, AT)], removed, UNDO),
    ).toEqual([{ kind: "programSlot", id: BENCH, field: "sets", value: bench.sets, at: UNDO }]);
  });

  it("undoing a creation removes, undoing a removal restores", () => {
    const created: ProgramEdit[] = [
      ...createProgram(before, NEW, AT)!,
      ...addSession(before, NEW, P2, AT)!,
      ...addSlot(before, NEW_SLOT, A, PLANK, AT)!,
    ];
    const live: StoredPrograms = {
      ...before,
      programs: [...before.programs, program(NEW)],
      sessions: [
        ...before.sessions,
        { id: NEW, name: null, programId: P2, position: 0, removed: false },
      ],
      slots: [
        ...before.slots,
        { ...bench, id: NEW_SLOT, exerciseId: PLANK.id, measure: "seconds", repRange: [30, 60] },
      ],
    };
    expect(undoOf(before, created, live, UNDO)).toEqual([
      { kind: "programSlot", id: NEW_SLOT, field: "removed", value: true, at: UNDO },
      { kind: "programSession", id: NEW, field: "removed", value: true, at: UNDO },
      { kind: "program", id: NEW, field: "removed", value: true, at: UNDO },
    ]);
    // Already removed by another device: nothing to write.
    const gone = withSlot(withSession(live, NEW, { removed: true }), NEW_SLOT, { removed: true });
    expect(undoOf(before, created.slice(1), gone, UNDO)).toEqual([]);

    const removals: ProgramEdit[] = [
      ...removeSession(B, AT),
      ...removeSlot(BENCH, AT),
      { kind: "program", id: P2, field: "removed", value: true, at: AT },
    ];
    const now = withProgram(
      withSlot(withSession(before, B, { removed: true }), BENCH, { removed: true }),
      P2,
      { removed: true },
    );
    expect(undoOf(before, removals, now, UNDO)).toEqual([
      { kind: "program", id: P2, field: "removed", value: false, at: UNDO },
      { kind: "programSlot", id: BENCH, field: "removed", value: false, at: UNDO },
      { kind: "programSession", id: B, field: "removed", value: false, at: UNDO },
    ]);
  });

  it("undoing a session move restores every place it changed", () => {
    // C first: C, A and B each take a new position.
    const edit = placeSession(before, C, SEED_PROGRAM_ID, 0, AT)!;
    expect(edit).toHaveLength(3);
    let now = withSession(before, C, { position: 0 });
    now = withSession(now, A, { position: 1 });
    now = withSession(now, B, { position: 2 });
    const undo = undoOf(before, edit, now, UNDO);
    const place = (id: string, position: number) => ({
      kind: "programSession",
      id,
      field: "place",
      programId: SEED_PROGRAM_ID,
      position,
      at: UNDO,
    });
    expect(undo).toEqual(expect.arrayContaining([place(A, 0), place(B, 1), place(C, 2)]));
    expect(undo).toHaveLength(3);
    // A set aside since by another device keeps its new place.
    const moved = withSession(now, A, { programId: null, position: 0 });
    expect(undoOf(before, edit, moved, UNDO)).toEqual(
      expect.arrayContaining([place(B, 1), place(C, 2)]),
    );
    expect(undoOf(before, edit, moved, UNDO)).toHaveLength(2);
  });

  it("undoing a switch points back first", () => {
    const edit: ProgramEdit[] = [
      ...createProgram(before, NEW, AT)!,
      { kind: "activeProgram", programId: NEW, at: AT },
    ];
    const now: StoredPrograms = {
      ...before,
      activeId: NEW,
      activeAt: AT,
      programs: [...before.programs, program(NEW)],
    };
    expect(undoOf(before, edit, now, UNDO)).toEqual([
      { kind: "activeProgram", programId: SEED_PROGRAM_ID, at: UNDO },
      { kind: "program", id: NEW, field: "removed", value: true, at: UNDO },
    ]);
    // Another program chosen since, or the previous one removed since: the pointer stays.
    const switched = chooseActive(before, P2, AT)!;
    const after = { ...before, activeId: P2, activeAt: AT };
    expect(undoOf(before, switched, { ...after, activeId: P3 }, UNDO)).toEqual([]);
    expect(
      undoOf(before, switched, withProgram(after, SEED_PROGRAM_ID, { removed: true }), UNDO),
    ).toEqual([]);
    // The active program removed with its pointer moved first: both come back, the pointer first.
    const removal: ProgramEdit[] = [
      { kind: "activeProgram", programId: P2, at: AT },
      { kind: "program", id: SEED_PROGRAM_ID, field: "removed", value: true, at: AT },
    ];
    expect(
      undoOf(before, removal, withProgram(after, SEED_PROGRAM_ID, { removed: true }), UNDO),
    ).toEqual([
      { kind: "activeProgram", programId: SEED_PROGRAM_ID, at: UNDO },
      { kind: "program", id: SEED_PROGRAM_ID, field: "removed", value: false, at: UNDO },
    ]);
  });

  it("undoing an exercise swap restores exercise, measure, range and warm-ups together", () => {
    const edit = replaceExercise(before, BENCH, PLANK, AT)!;
    const now = withSlot(before, BENCH, {
      exerciseId: PLANK.id,
      measure: "seconds",
      repRange: [30, 60],
      warmupSets: 0,
    });
    expect(undoOf(before, edit, now, UNDO)).toEqual([
      {
        kind: "programSlot",
        id: BENCH,
        field: "exercise",
        exerciseId: bench.exerciseId,
        measure: null,
        repRange: bench.repRange,
        warmupSets: bench.warmupSets,
        at: UNDO,
      },
    ]);
    // Swapped again since by another device: left alone.
    const again = withSlot(now, BENCH, { exerciseId: "ds:0001" });
    expect(undoOf(before, edit, again, UNDO)).toEqual([]);
  });

  it("a range edit whose slot changed measure since is skipped", () => {
    const edit: ProgramEdit[] = [
      ...editSlot(before, BENCH, { field: "reps", value: [10, 12] }, AT)!,
      ...editSlot(before, BENCH, { field: "warmups", value: 1 }, AT)!,
    ];
    // Timed since, with the same numbers: seconds now, not the repetitions the edit wrote.
    const timed = withSlot(before, BENCH, {
      measure: "seconds",
      repRange: [10, 12],
      warmupSets: 1,
    });
    expect(undoOf(before, edit, timed, UNDO)).toEqual([]);
    // Same measure: both come back, carrying it.
    const counted = withSlot(before, BENCH, { repRange: [10, 12], warmupSets: 1 });
    expect(undoOf(before, edit, counted, UNDO)).toEqual([
      {
        kind: "programSlot",
        id: BENCH,
        field: "warmups",
        value: bench.warmupSets,
        measure: null,
        at: UNDO,
      },
      {
        kind: "programSlot",
        id: BENCH,
        field: "reps",
        value: bench.repRange,
        measure: null,
        at: UNDO,
      },
    ]);
  });

  it("an undo whose clock is behind the edit lands just after it, so it still restores", () => {
    const LATER = "2026-10-25T08:00:30.000Z";
    const edit: ProgramEdit[] = [
      ...editSlot(before, BENCH, { field: "sets", value: 5 }, AT)!,
      ...renameProgram(P2, "Été", LATER),
    ];
    const now = withProgram(withSlot(before, BENCH, { sets: 5 }), P2, { name: "Été" });
    const AFTER = "2026-10-25T08:00:30.001Z"; // the edit's latest time, plus one millisecond
    for (const clock of ["2026-10-25T07:00:00.000Z", LATER]) {
      const undo = undoOf(before, edit, now, clock);
      expect(undo).toEqual([
        { kind: "program", id: P2, field: "name", value: null, at: AFTER },
        { kind: "programSlot", id: BENCH, field: "sets", value: bench.sets, at: AFTER },
      ]);
      // Strictly newer than what the edit wrote: last write wins puts the old values back.
      for (const change of undo) expect(isNewer(change.at, LATER)).toBe(true);
    }
    // A clock ahead of the edit keeps its own time.
    expect(undoOf(before, edit, now, UNDO).map((c) => c.at)).toEqual([UNDO, UNDO]);
  });

  it("every undo change passes isValidChange", () => {
    const edit: ProgramEdit[] = [
      ...createProgram(before, NEW, AT)!,
      { kind: "activeProgram", programId: NEW, at: AT },
      ...renameProgram(P2, "Été", AT),
      ...placeSession(before, C, null, 0, AT)!,
      ...renameSession(A, "Haut", AT),
      ...editSlot(before, BENCH, { field: "reps", value: [10, 12] }, AT)!,
      ...editSlot(before, BENCH, { field: "sets", value: 5 }, AT)!,
      ...addSlot(before, NEW_SLOT, A, PLANK, AT)!,
    ];
    let now: StoredPrograms = {
      ...before,
      activeId: NEW,
      activeAt: AT,
      programs: [...before.programs, program(NEW)],
      slots: [...before.slots, { ...bench, id: NEW_SLOT, exerciseId: PLANK.id }],
    };
    now = withProgram(now, P2, { name: "Été" });
    now = withSession(now, C, { programId: null, position: 0 });
    now = withSession(now, A, { name: "Haut" });
    now = withSlot(now, BENCH, { repRange: [10, 12], sets: 5 });
    const undo = undoOf(before, edit, now, UNDO);
    expect(undo).toHaveLength(8);
    expect(undo[0]!.kind).toBe("activeProgram");
    for (const change of undo) expect(isValidChange(change), JSON.stringify(change)).toBe(true);
  });
});
