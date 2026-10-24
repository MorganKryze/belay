import { describe, expect, it } from "vitest";
import type { Change } from "../sync/schema";
import { isValidChange } from "../sync/valid";
import {
  addSession,
  addSlot,
  chooseActive,
  createProgram,
  editSlot,
  moveSlot,
  placeSession,
  removeProgram,
  removeSession,
  removeSlot,
  renameProgram,
  renameSession,
  replaceExercise,
  setSchedule,
} from "./program-edits";
import {
  DEFAULT_SCHEDULE,
  MAX_PROGRAMS,
  MAX_ROTATION,
  MAX_SESSIONS,
  type Program,
  type ProgramSession,
  type ProgramSlot,
  SEED,
  SEED_PROGRAM_ID,
  seedId,
  type StoredPrograms,
  withSeed,
} from "./stored-program";
import { MAX_SLOTS } from "./workout";

const AT = "2026-10-25T08:00:00.000Z";
const NEW = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d95";
const P2 = seedId(0xa02);
const [A, B, C] = SEED.sessions.map((s) => s.id) as [string, string, string];

const prog = (id: string, patch: Partial<Program> = {}): Program => ({
  id,
  name: null,
  schedule: DEFAULT_SCHEDULE,
  removed: false,
  ...patch,
});
const session = (id: string, patch: Partial<ProgramSession> = {}): ProgramSession => ({
  id,
  name: null,
  programId: P2,
  position: 0,
  removed: false,
  ...patch,
});
const slot = (id: string, patch: Partial<ProgramSlot> = {}): ProgramSlot => ({
  id,
  sessionId: A,
  position: 0,
  exerciseId: "ds:0025",
  sets: 3,
  repRange: [8, 12],
  rirTarget: [1, 2],
  restSec: 90,
  warmupSets: 2,
  isMain: false,
  groupKey: null,
  rule: null,
  removed: false,
  ...patch,
});
// The starting program, plus a second program holding X and Y, and a set-aside session Z.
const X = seedId(0xb01);
const Y = seedId(0xb02);
const Z = seedId(0xb03);
const two: StoredPrograms = withSeed({
  programs: [prog(P2)],
  sessions: [
    session(X, { position: 0 }),
    session(Y, { position: 1 }),
    session(Z, { programId: null, position: 0 }),
  ],
});
// n extra rows of a kind, ids from base.
const many = <T>(n: number, base: number, make: (id: string, i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => make(seedId(base + i), i));

describe("programs (ED1, ED2, PM11)", () => {
  it("creates a program with no name and the rotation schedule, written once", () => {
    expect(createProgram(SEED, NEW, AT)).toEqual([
      {
        kind: "program",
        id: NEW,
        field: "create",
        name: null,
        schedule: DEFAULT_SCHEDULE,
        at: AT,
      },
    ]);
  });

  it("a 21st program is refused; a removed one does not count", () => {
    const full = withSeed({ programs: many(MAX_PROGRAMS - 1, 0xc00, (id) => prog(id)) });
    expect(createProgram(full, NEW, AT)).toBeNull();
    const oneRemoved = withSeed({
      programs: many(MAX_PROGRAMS - 1, 0xc00, (id, i) => prog(id, { removed: i === 0 })),
    });
    expect(createProgram(oneRemoved, NEW, AT)).toHaveLength(1);
  });

  it("removing the active program is refused; another one is removed", () => {
    expect(removeProgram(two, SEED_PROGRAM_ID, AT)).toBeNull();
    expect(removeProgram(two, P2, AT)).toEqual([
      { kind: "program", id: P2, field: "removed", value: true, at: AT },
    ]);
  });

  it("renames a program, changes its schedule, and chooses a live one as active", () => {
    expect(renameProgram(P2, "Force", AT)).toEqual([
      { kind: "program", id: P2, field: "name", value: "Force", at: AT },
    ]);
    const fixed = { mode: "fixed" as const, days: [A, null, B, null, C, null, null] };
    expect(setSchedule(P2, fixed, AT)).toEqual([
      { kind: "program", id: P2, field: "schedule", value: fixed, at: AT },
    ]);
    expect(chooseActive(two, P2, AT)).toEqual([{ kind: "activeProgram", programId: P2, at: AT }]);
    const removed = withSeed({ programs: [prog(P2, { removed: true })] });
    expect(chooseActive(removed, P2, AT)).toBeNull();
    expect(chooseActive(two, NEW, AT)).toBeNull();
  });
});

describe("sessions (ED1, PM11)", () => {
  it("adds a session at the end of a rotation, or of the collection", () => {
    expect(addSession(two, NEW, SEED_PROGRAM_ID, AT)).toEqual([
      {
        kind: "programSession",
        id: NEW,
        field: "create",
        name: null,
        programId: SEED_PROGRAM_ID,
        position: 3,
        at: AT,
      },
    ]);
    expect(addSession(two, NEW, null, AT)).toMatchObject([{ programId: null, position: 1 }]);
    expect(addSession(two, NEW, seedId(0xfff), AT)).toBeNull(); // a program it lacks
  });

  it("adds after the last live session when removals left gaps, refused past position 999", () => {
    const gaps = withSeed({
      programs: [prog(P2)],
      sessions: [session(X, { position: 9, removed: true }), session(Y, { position: 4 })],
    });
    expect(addSession(gaps, NEW, P2, AT)).toMatchObject([{ programId: P2, position: 5 }]);
    expect(addSession(gaps, NEW, null, AT)).toMatchObject([{ programId: null, position: 0 }]);
    const last = withSeed({ programs: [prog(P2)], sessions: [session(Y, { position: 999 })] });
    expect(addSession(last, NEW, P2, AT)).toBeNull();
  });

  it("a 201st session and a 27th in a rotation are refused", () => {
    const aside = withSeed({
      sessions: many(MAX_SESSIONS - 3, 0xd00, (id, i) =>
        session(id, { programId: null, position: i }),
      ),
    });
    expect(addSession(aside, NEW, null, AT)).toBeNull();
    const rotation = withSeed({
      sessions: many(MAX_ROTATION - 3, 0xd00, (id, i) =>
        session(id, { programId: SEED_PROGRAM_ID, position: 3 + i }),
      ),
    });
    expect(addSession(rotation, NEW, SEED_PROGRAM_ID, AT)).toBeNull();
    expect(addSession(rotation, NEW, null, AT)).toHaveLength(1);
    // A removed session counts for neither.
    const freed = withSeed({
      ...rotation,
      sessions: rotation.sessions.map((s) => (s.id === A ? { ...s, removed: true } : s)),
    });
    expect(addSession(freed, NEW, SEED_PROGRAM_ID, AT)).toHaveLength(1);
  });

  it("setting a session aside writes its place with no program, and closes the rotation up", () => {
    expect(placeSession(two, B, null, 0, AT)).toEqual([
      { kind: "programSession", id: B, field: "place", programId: null, position: 0, at: AT },
      { kind: "programSession", id: Z, field: "place", programId: null, position: 1, at: AT },
      {
        kind: "programSession",
        id: C,
        field: "place",
        programId: SEED_PROGRAM_ID,
        position: 1,
        at: AT,
      },
    ]);
  });

  it("moving a session into another program writes the positions that move in both", () => {
    const changes = placeSession(two, A, P2, 1, AT);
    expect(changes).toEqual([
      { kind: "programSession", id: A, field: "place", programId: P2, position: 1, at: AT },
      { kind: "programSession", id: Y, field: "place", programId: P2, position: 2, at: AT },
      {
        kind: "programSession",
        id: B,
        field: "place",
        programId: SEED_PROGRAM_ID,
        position: 0,
        at: AT,
      },
      {
        kind: "programSession",
        id: C,
        field: "place",
        programId: SEED_PROGRAM_ID,
        position: 1,
        at: AT,
      },
    ]);
    // X keeps its place: nothing written for it.
    expect(changes!.some((c) => "id" in c && c.id === X)).toBe(false);
  });

  it("reorders a rotation, writing only the sessions that move", () => {
    expect(placeSession(two, C, SEED_PROGRAM_ID, 0, AT)).toEqual(
      [
        [C, 0],
        [A, 1],
        [B, 2],
      ].map(([id, position]) => ({
        kind: "programSession",
        id,
        field: "place",
        programId: SEED_PROGRAM_ID,
        position,
        at: AT,
      })),
    );
    expect(placeSession(two, A, SEED_PROGRAM_ID, 0, AT)).toEqual([]);
    // Past the end: last.
    expect(placeSession(two, A, SEED_PROGRAM_ID, 9, AT)).toMatchObject([
      { id: B, position: 0 },
      { id: C, position: 1 },
      { id: A, position: 2 },
    ]);
  });

  it("refuses a placement past 26 in a rotation, an unknown session or program", () => {
    const full = withSeed({
      programs: [prog(P2)],
      sessions: [
        ...many(MAX_ROTATION, 0xd00, (id, i) => session(id, { position: i })),
        session(Z, { programId: null }),
      ],
    });
    expect(placeSession(full, Z, P2, 0, AT)).toBeNull();
    expect(placeSession(full, A, P2, 0, AT)).toBeNull();
    // Within the full rotation, a reorder is no placement past it.
    expect(placeSession(full, seedId(0xd00), P2, 3, AT)).not.toBeNull();
    expect(placeSession(two, NEW, null, 0, AT)).toBeNull();
    expect(placeSession(two, A, seedId(0xfff), 0, AT)).toBeNull();
  });

  it("renames and removes a session", () => {
    expect(renameSession(Z, "Mobilité", AT)).toEqual([
      { kind: "programSession", id: Z, field: "name", value: "Mobilité", at: AT },
    ]);
    expect(removeSession(Z, AT)).toEqual([
      { kind: "programSession", id: Z, field: "removed", value: true, at: AT },
    ]);
  });
});

describe("slots (ED1, ED3, ED4)", () => {
  const exercise = { id: "ds:0047", measure: "reps" as const };
  const seedA = SEED.slots.filter((s) => s.sessionId === A);

  it("adds a slot at the end of its section with the default targets", () => {
    expect(addSlot(SEED, NEW, A, exercise, AT)).toEqual([
      {
        kind: "programSlot",
        id: NEW,
        field: "create",
        sessionId: A,
        position: seedA.length,
        rule: null,
        exerciseId: "ds:0047",
        sets: 3,
        repRange: [8, 12],
        rirTarget: [1, 2],
        restSec: 90,
        warmupSets: 0,
        isMain: false,
        groupKey: null,
        at: AT,
      },
    ]);
    const timed = addSlot(SEED, NEW, C, { id: "ds:2135", measure: "seconds" }, AT, "no_climbing");
    expect(timed).toMatchObject([
      { measure: "seconds", repRange: [30, 60], rule: "no_climbing", position: 2 },
    ]);
  });

  it("adds after the last live slot of its section when removals left gaps", () => {
    const S1 = seedId(0xe01);
    const S2 = seedId(0xe02);
    const gaps = withSeed({
      slots: [slot(S1, { position: 7 }), slot(S2, { position: 20, removed: true })],
    });
    expect(addSlot(gaps, NEW, A, exercise, AT)).toMatchObject([{ position: 8 }]);
    expect(addSlot(gaps, NEW, A, exercise, AT, "no_climbing")).toMatchObject([{ position: 0 }]);
    const last = withSeed({ slots: [slot(S1, { position: 999 })] });
    expect(addSlot(last, NEW, A, exercise, AT)).toBeNull();
  });

  it("a 31st slot is refused; a removed one does not count", () => {
    const full = withSeed({
      slots: many(MAX_SLOTS - seedA.length, 0xe00, (id, i) =>
        slot(id, { position: seedA.length + i }),
      ),
    });
    expect(addSlot(full, NEW, A, exercise, AT)).toBeNull();
    expect(addSlot(full, NEW, A, exercise, AT, "no_climbing")).toBeNull();
    const freed = withSeed({
      slots: full.slots.map((s) => (s.id === seedA[0]!.id ? { ...s, removed: true } : s)),
    });
    expect(addSlot(freed, NEW, A, exercise, AT)).toHaveLength(1);
    expect(addSlot(SEED, NEW, seedId(0xfff), exercise, AT)).toBeNull();
  });

  it("changes one value of a slot, refusing one its slot cannot hold", () => {
    const id = seedA[0]!.id;
    expect(editSlot(SEED, id, { field: "sets", value: 5 }, AT)).toEqual([
      { kind: "programSlot", id, field: "sets", value: 5, at: AT },
    ]);
    expect(editSlot(SEED, id, { field: "reps", value: [6, 10] }, AT)).toHaveLength(1);
    expect(editSlot(SEED, id, { field: "reps", value: [6, 101] }, AT)).toBeNull(); // counted
    const timed = withSeed({ slots: [slot(NEW, { measure: "seconds", repRange: [30, 60] })] });
    expect(editSlot(timed, NEW, { field: "reps", value: [60, 600] }, AT)).toHaveLength(1);
    expect(editSlot(SEED, id, { field: "group", value: "a-b" }, AT)).toBeNull();
    expect(editSlot(SEED, NEW, { field: "sets", value: 5 }, AT)).toBeNull();
  });

  describe("another exercise (ED4)", () => {
    const counted = withSeed({ slots: [slot(NEW, { repRange: [6, 8], warmupSets: 2 })] });
    const timed = withSeed({
      slots: [slot(NEW, { measure: "seconds", repRange: [20, 40], warmupSets: 0 })],
    });

    it("in the same measure writes the exercise alone", () => {
      expect(replaceExercise(counted, NEW, exercise, AT)).toEqual([
        {
          kind: "programSlot",
          id: NEW,
          field: "exercise",
          exerciseId: "ds:0047",
          measure: null,
          at: AT,
        },
      ]);
    });

    it("counted in seconds writes its measure, the 30-60 s target and no warm-up together", () => {
      expect(replaceExercise(counted, NEW, { id: "ds:2135", measure: "seconds" }, AT)).toEqual([
        {
          kind: "programSlot",
          id: NEW,
          field: "exercise",
          exerciseId: "ds:2135",
          measure: "seconds",
          at: AT,
        },
        { kind: "programSlot", id: NEW, field: "reps", value: [30, 60], at: AT },
        { kind: "programSlot", id: NEW, field: "warmups", value: 0, at: AT },
      ]);
    });

    it("counted in reps writes the 8-12 target and keeps the warm-ups", () => {
      expect(replaceExercise(timed, NEW, exercise, AT)).toEqual([
        {
          kind: "programSlot",
          id: NEW,
          field: "exercise",
          exerciseId: "ds:0047",
          measure: null,
          at: AT,
        },
        { kind: "programSlot", id: NEW, field: "reps", value: [8, 12], at: AT },
      ]);
    });

    it("of a slot it lacks is refused", () => {
      expect(replaceExercise(SEED, NEW, exercise, AT)).toBeNull();
    });
  });

  it("moves a slot within its section, writing only the slots that move", () => {
    const [first, second, third] = seedA as [ProgramSlot, ProgramSlot, ProgramSlot];
    expect(moveSlot(SEED, third.id, 0, AT)).toEqual(
      [
        [third.id, 0],
        [first.id, 1],
        [second.id, 2],
      ].map(([id, value]) => ({ kind: "programSlot", id, field: "position", value, at: AT })),
    );
    // C's no-climbing slots move among themselves only.
    const [nc1, nc2] = SEED.slots.filter((s) => s.rule === "no_climbing") as [
      ProgramSlot,
      ProgramSlot,
    ];
    expect(moveSlot(SEED, nc2.id, 0, AT)).toEqual([
      { kind: "programSlot", id: nc2.id, field: "position", value: 0, at: AT },
      { kind: "programSlot", id: nc1.id, field: "position", value: 1, at: AT },
    ]);
    expect(moveSlot(SEED, NEW, 0, AT)).toBeNull();
  });

  it("removes a slot", () => {
    expect(removeSlot(NEW, AT)).toEqual([
      { kind: "programSlot", id: NEW, field: "removed", value: true, at: AT },
    ]);
  });
});

describe("every change built", () => {
  it("passes isValidChange, so the phone may queue it", () => {
    const id = SEED.slots[0]!.id;
    const built = (
      [
        createProgram(two, NEW, AT),
        renameProgram(P2, "Force", AT),
        renameProgram(P2, null, AT),
        setSchedule(P2, DEFAULT_SCHEDULE, AT),
        removeProgram(two, P2, AT),
        chooseActive(two, P2, AT),
        addSession(two, NEW, P2, AT),
        addSession(two, NEW, null, AT),
        renameSession(A, "Poussée", AT),
        placeSession(two, A, P2, 0, AT),
        placeSession(two, B, null, 0, AT),
        removeSession(A, AT),
        addSlot(SEED, NEW, A, { id: "ds:0047", measure: "reps" }, AT),
        addSlot(SEED, NEW, C, { id: "ds:2135", measure: "seconds" }, AT, "no_climbing"),
        editSlot(SEED, id, { field: "reps", value: [5, 5] }, AT),
        editSlot(SEED, id, { field: "sets", value: 10 }, AT),
        editSlot(SEED, id, { field: "rir", value: [0, 4] }, AT),
        editSlot(SEED, id, { field: "rest", value: 900 }, AT),
        editSlot(SEED, id, { field: "warmups", value: 3 }, AT),
        editSlot(SEED, id, { field: "main", value: false }, AT),
        editSlot(SEED, id, { field: "group", value: "A1" }, AT),
        editSlot(SEED, id, { field: "rule", value: "no_climbing" }, AT),
        replaceExercise(SEED, id, { id: "ds:2135", measure: "seconds" }, AT),
        moveSlot(SEED, id, 2, AT),
        removeSlot(id, AT),
      ] as (readonly Change[] | null)[]
    ).flatMap((changes): (Change | null)[] => (changes ? [...changes] : [null]));
    expect(built).not.toContain(null);
    expect(built.filter((c) => !isValidChange(c!))).toEqual([]);
  });
});
