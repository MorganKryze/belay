import { describe, expect, it } from "vitest";
import { mergeSlotChange } from "../sync/merge";
import type {
  Change,
  ProgramSessionChange,
  ProgramSlotChange,
  ProgramSlotRow,
} from "../sync/schema";
import { isValidChange } from "../sync/valid";
import {
  addSession,
  addSlot,
  chainWithNext,
  chooseActive,
  copySession,
  copySlot,
  copySlotsInto,
  createProgram,
  editSlot,
  leaveGroup,
  letterMoves,
  moveSlot,
  neighbourOf,
  newProgram,
  placeSession,
  programOrder,
  putBack,
  removeProgram,
  removeProgramFor,
  removeSession,
  removeSessionIn,
  removeSlot,
  renameProgram,
  renameSession,
  replaceExercise,
  setAside,
  setSchedule,
} from "./program-edits";
import { placeSlot } from "./slot-moves";
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
// New ids as newId() gives them, in order, from base.
const ids = (base: number) => {
  let n = 0;
  return () => seedId(base + n++);
};
// What a builder returns, checked as the phone checks it before queueing: built, and every change
// valid.
function valid<T extends Change>(changes: readonly T[] | null): T[] {
  expect(changes).not.toBeNull();
  expect(changes!.filter((c) => !isValidChange(c))).toEqual([]);
  return [...changes!];
}
// A slot's values without what places it, to compare a copy with its source.
const VALUES = [
  "exerciseId",
  "measure",
  "sets",
  "repRange",
  "rirTarget",
  "restSec",
  "warmupSets",
  "isMain",
  "groupKey",
  "rule",
] as const;
const valuesOf = (s: object) =>
  Object.fromEntries(
    VALUES.flatMap((k) => {
      const v = (s as Record<string, unknown>)[k];
      return v === undefined ? [] : [[k, v]];
    }),
  );

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
    expect(editSlot(SEED, id, { field: "reps", value: [6, 101] }, AT)).toBeNull(); // counted
    expect(editSlot(SEED, id, { field: "group", value: "a-b" }, AT)).toBeNull();
    expect(editSlot(SEED, NEW, { field: "sets", value: 5 }, AT)).toBeNull();
  });

  it("writes a rep range or warm-ups with the measure they were written for (ED4)", () => {
    const id = seedA[0]!.id;
    expect(editSlot(SEED, id, { field: "reps", value: [6, 10] }, AT)).toEqual([
      { kind: "programSlot", id, field: "reps", value: [6, 10], measure: null, at: AT },
    ]);
    expect(editSlot(SEED, id, { field: "warmups", value: 1 }, AT)).toEqual([
      { kind: "programSlot", id, field: "warmups", value: 1, measure: null, at: AT },
    ]);
    const timed = withSeed({ slots: [slot(NEW, { measure: "seconds", repRange: [30, 60] })] });
    expect(editSlot(timed, NEW, { field: "reps", value: [60, 600] }, AT)).toEqual([
      { kind: "programSlot", id: NEW, field: "reps", value: [60, 600], measure: "seconds", at: AT },
    ]);
  });

  describe("another exercise (ED4)", () => {
    const counted = withSeed({ slots: [slot(NEW, { repRange: [6, 8], warmupSets: 2 })] });
    const timed = withSeed({
      slots: [slot(NEW, { measure: "seconds", repRange: [20, 40], warmupSets: 0 })],
    });

    it("in the same measure writes the exercise with the range and warm-ups it keeps", () => {
      expect(replaceExercise(counted, NEW, exercise, AT)).toEqual([
        {
          kind: "programSlot",
          id: NEW,
          field: "exercise",
          exerciseId: "ds:0047",
          measure: null,
          repRange: [6, 8],
          warmupSets: 2,
          at: AT,
        },
      ]);
    });

    it("counted in seconds writes its measure, the 30-60 s target and no warm-up in one change", () => {
      expect(replaceExercise(counted, NEW, { id: "ds:2135", measure: "seconds" }, AT)).toEqual([
        {
          kind: "programSlot",
          id: NEW,
          field: "exercise",
          exerciseId: "ds:2135",
          measure: "seconds",
          repRange: [30, 60],
          warmupSets: 0,
          at: AT,
        },
      ]);
    });

    it("counted in reps writes the 8-12 target and keeps the warm-ups, in one change", () => {
      expect(replaceExercise(timed, NEW, exercise, AT)).toEqual([
        {
          kind: "programSlot",
          id: NEW,
          field: "exercise",
          exerciseId: "ds:0047",
          measure: null,
          repRange: [8, 12],
          warmupSets: 0,
          at: AT,
        },
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
    expect(removeSlot(SEED, NEW, AT)).toEqual([
      { kind: "programSlot", id: NEW, field: "removed", value: true, at: AT },
    ]);
  });
});

// Session X of the second program: a plain row, a group G of three, a plain row, a group H of two.
const R = (i: number) => seedId(0x1000 + i);
const rowsOf = (
  keys: readonly (string | null)[],
  patch: (i: number) => Partial<ProgramSlot> = () => ({}),
) => keys.map((groupKey, i) => slot(R(i), { sessionId: X, position: i, groupKey, ...patch(i) }));
const withRows = (slots: readonly ProgramSlot[], patch: Partial<StoredPrograms> = {}) =>
  withSeed({ programs: two.programs, sessions: two.sessions, slots, ...patch });
const grouped = withRows(rowsOf([null, "G", "G", "G", null, "H", "H"]));
const group = (id: string, value: string | null) => ({
  kind: "programSlot",
  id,
  field: "group",
  value,
  at: AT,
});
const position = (id: string, value: number) => ({
  kind: "programSlot",
  id,
  field: "position",
  value,
  at: AT,
});

describe("removing a grouped slot", () => {
  it("clears the key of the one row a group of two is left with", () => {
    expect(removeSlot(grouped, R(5), AT)).toEqual([
      { kind: "programSlot", id: R(5), field: "removed", value: true, at: AT },
      group(R(6), null),
    ]);
  });

  it("leaves a group of three its two others", () => {
    expect(removeSlot(grouped, R(1), AT)).toEqual([
      { kind: "programSlot", id: R(1), field: "removed", value: true, at: AT },
    ]);
  });

  it("gives the lower of two runs of one key it kept apart a key of its own", () => {
    const apart = withRows(rowsOf(["G", "G", null, "G", "G"]));
    const key = R(3).replace(/-/g, "").slice(-12);
    expect(valid(removeSlot(apart, R(2), AT))).toEqual([
      { kind: "programSlot", id: R(2), field: "removed", value: true, at: AT },
      group(R(3), key),
      group(R(4), key),
    ]);
  });
});

describe("a slot like another", () => {
  const like = slot(NEW, {
    sets: 5,
    repRange: [4, 6],
    rirTarget: [0, 1],
    restSec: 180,
    warmupSets: 3,
    isMain: true,
    groupKey: "G",
  });

  it("copies sets, RIR, rest, warm-ups and, in the same measure, the range; never main or group", () => {
    expect(
      valid(addSlot(SEED, R(9), A, { id: "ds:0047", measure: "reps" }, AT, null, like)),
    ).toMatchObject([
      {
        sets: 5,
        repRange: [4, 6],
        rirTarget: [0, 1],
        restSec: 180,
        warmupSets: 3,
        isMain: false,
        groupKey: null,
      },
    ]);
  });

  it("a timed exercise keeps its own target and takes no warm-up", () => {
    expect(
      valid(addSlot(SEED, R(9), A, { id: "ds:2135", measure: "seconds" }, AT, null, like)),
    ).toMatchObject([
      { measure: "seconds", sets: 5, repRange: [30, 60], restSec: 180, warmupSets: 0 },
    ]);
  });
});

describe("copies", () => {
  it("a copied slot sits right below with the source's values, in its group, the rows after move down", () => {
    const state = withRows(
      rowsOf([null, "G", "G", "G", null], (i) =>
        i === 2
          ? {
              sets: 4,
              repRange: [5, 7],
              rirTarget: [0, 1],
              restSec: 120,
              warmupSets: 1,
              isMain: true,
            }
          : {},
      ),
    );
    const source = state.slots.find((s) => s.id === R(2))!;
    const changes = valid(copySlot(state, NEW, R(2), AT));
    expect(changes[0]).toEqual({
      kind: "programSlot",
      id: NEW,
      field: "create",
      sessionId: X,
      position: 3,
      at: AT,
      ...valuesOf(source),
    });
    expect(changes[0]).toMatchObject({ groupKey: "G", sets: 4, isMain: true });
    expect(changes.slice(1)).toEqual([position(R(3), 4), position(R(4), 5)]);
  });

  it("a row alone with a key is copied with no key, so the two never make a group", () => {
    const alone = withRows(rowsOf([null, "G", null]));
    expect(valid(copySlot(alone, NEW, R(1), AT))[0]).toMatchObject({ id: NEW, groupKey: null });
  });

  it("a copied slot closes the gaps its section had, so it sorts right below its source", () => {
    const gaps = withRows(rowsOf([null, null, null], (i) => ({ position: i * 5 })));
    expect(valid(copySlot(gaps, NEW, R(1), AT))).toEqual([
      position(R(1), 1),
      expect.objectContaining({ id: NEW, position: 2 }),
      position(R(2), 3),
    ]);
  });

  it("a copied session goes last with every slot, new ids, both sections", () => {
    const changes = valid(copySession(SEED, C, "C (copie)", ids(0xf00), AT));
    const copy = seedId(0xf00);
    expect(changes[0]).toEqual({
      kind: "programSession",
      id: copy,
      field: "create",
      name: "C (copie)",
      programId: SEED_PROGRAM_ID,
      position: 3,
      at: AT,
    });
    const source = SEED.slots.filter((s) => s.sessionId === C);
    const slots = changes.slice(1) as Extract<ProgramSlotChange, { field: "create" }>[];
    expect(slots.map(valuesOf)).toEqual(source.map(valuesOf));
    expect(slots.map((s) => [s.sessionId, s.rule, s.position])).toEqual(
      source.map((s) => [copy, s.rule, s.position]),
    );
    expect(new Set(slots.map((s) => s.id)).size).toBe(source.length);
    expect(slots.some((s) => SEED.slots.some((x) => x.id === s.id))).toBe(false);
    expect(slots.some((s) => s.rule === "no_climbing")).toBe(true);
  });

  it("a copy of a set-aside session stays in the collection; removed slots are not copied", () => {
    const state = withSeed({
      ...two,
      slots: [
        slot(R(0), { sessionId: Z }),
        slot(R(1), { sessionId: Z, position: 1, removed: true }),
      ],
    });
    expect(valid(copySession(state, Z, null, ids(0xf00), AT))).toMatchObject([
      { field: "create", programId: null, position: 1, name: null },
      { field: "create", sessionId: seedId(0xf00), position: 0 },
    ]);
    expect(copySession(state, Z, null, ids(0xf00), AT)).toHaveLength(2);
    expect(copySession(state, NEW, null, ids(0xf00), AT)).toBeNull();
  });

  it("copying into an empty session appends the source's slots", () => {
    const changes = valid(copySlotsInto(two, Y, C, ids(0xf00), AT));
    const source = SEED.slots.filter((s) => s.sessionId === C);
    expect(changes.map(valuesOf).map(({ groupKey, ...v }) => [v, groupKey === null])).toEqual(
      source.map(valuesOf).map(({ groupKey, ...v }) => [v, groupKey === null]),
    );
    expect(changes.every((c) => c.field === "create" && c.sessionId === Y)).toBe(true);
  });

  it("a copied group takes a fresh key from its first row, so it never merges with the target's", () => {
    const target = withRows([
      slot(R(0), { sessionId: Y, groupKey: "4" }),
      slot(R(1), { sessionId: Y, position: 1, groupKey: "4" }),
    ]);
    const changes = valid(copySlotsInto(target, Y, C, ids(0xf00), AT)) as Extract<
      ProgramSlotChange,
      { field: "create" }
    >[];
    const source = SEED.slots.filter((s) => s.sessionId === C && s.rule === null);
    // The normal section goes on after the target's rows, the no-climbing one starts at 0.
    expect(changes.filter((c) => c.rule === null).map((c) => c.position)).toEqual(
      source.map((_, i) => 2 + i),
    );
    // Each source group maps to one key, made from its first copied row's new id.
    const normal = changes.filter((c) => c.rule === null);
    const keyOf = (from: string) => normal[source.findIndex((s) => s.groupKey === from)]!;
    expect(keyOf("4").groupKey).toBe(keyOf("4").id.replace(/-/g, "").slice(-12));
    expect(keyOf("5").groupKey).toBe(keyOf("5").id.replace(/-/g, "").slice(-12));
    expect(normal.map((c) => c.groupKey)).toEqual(
      source.map((s) => (s.groupKey === null ? null : keyOf(s.groupKey).groupKey)),
    );
    expect(keyOf("4").groupKey).not.toBe("4");
    expect(keyOf("4").groupKey).not.toBe(keyOf("5").groupKey);
  });

  it("copying from a removed, unknown or empty session is no copy", () => {
    const removed = withSeed({
      ...two,
      sessions: two.sessions.map((s) => (s.id === X ? { ...s, removed: true } : s)),
      slots: [slot(R(0), { sessionId: X })],
    });
    expect(copySlotsInto(removed, Y, X, ids(0xf00), AT)).toBeNull();
    expect(copySlotsInto(two, Y, NEW, ids(0xf00), AT)).toBeNull();
    expect(copySlotsInto(two, Y, X, ids(0xf00), AT)).toBeNull();
  });

  it("a copied session's name is trimmed and cut to 40 like a typed one, and checked", () => {
    const named = (name: string | null) =>
      (valid(copySession(SEED, C, name, ids(0xf00), AT))[0] as { name: string | null }).name;
    expect(named(`  ${"x".repeat(45)}`)).toBe("x".repeat(40));
    expect(named(`${"a".repeat(39)} b`)).toBe("a".repeat(39));
    expect(named("   ")).toBeNull();
    expect(named(null)).toBeNull();
    // A cut never splits a character written in two units.
    expect(named(`${"a".repeat(39)}😀`)).toBe("a".repeat(39));
    expect(copySession(SEED, C, "Push\u0007", ids(0xf00), AT)).toBeNull();
  });

  it("a copy past 30 slots, 26 in a rotation or 200 sessions is refused whole", () => {
    const own = SEED.slots.filter((s) => s.sessionId === C).length;
    const nearly = withRows(
      many(MAX_SLOTS - own + 1, 0x1000, (id, i) => slot(id, { sessionId: Y, position: i })),
    );
    expect(copySlotsInto(nearly, Y, C, ids(0xf00), AT)).toBeNull();
    const fits = withRows(
      many(MAX_SLOTS - own, 0x1000, (id, i) => slot(id, { sessionId: Y, position: i })),
    );
    expect(copySlotsInto(fits, Y, C, ids(0xf00), AT)).not.toBeNull();
    const full = withRows(
      many(MAX_SLOTS, 0x1000, (id, i) => slot(id, { sessionId: X, position: i })),
    );
    expect(copySlot(full, NEW, R(0), AT)).toBeNull();
    // A source past 30 (two devices adding at once) is no copy either.
    const over = withRows(
      many(MAX_SLOTS + 1, 0x1000, (id, i) => slot(id, { sessionId: X, position: i })),
    );
    expect(copySession(over, X, null, ids(0xf00), AT)).toBeNull();
    const rotation = withSeed({
      sessions: many(MAX_ROTATION - 3, 0xd00, (id, i) =>
        session(id, { programId: SEED_PROGRAM_ID, position: 3 + i }),
      ),
    });
    expect(copySession(rotation, A, null, ids(0xf00), AT)).toBeNull();
    const account = withSeed({
      sessions: many(MAX_SESSIONS - 3, 0xd00, (id, i) =>
        session(id, { programId: null, position: i }),
      ),
    });
    expect(copySession(account, seedId(0xd00), null, ids(0xf00), AT)).toBeNull();
    expect(newProgram(account, { kind: "empty" }, "Nouveau programme", ids(0xf00), AT)).toBeNull();
    const programs = withSeed({ programs: many(MAX_PROGRAMS - 1, 0xc00, (id) => prog(id)) });
    expect(
      newProgram(programs, { kind: "starter" }, "Programme de départ", ids(0xf00), AT),
    ).toBeNull();
  });
});

describe("new programs", () => {
  it("a new empty program holds one session and becomes active", () => {
    const id = seedId(0xf00);
    expect(valid(newProgram(two, { kind: "empty" }, "Nouveau programme", ids(0xf00), AT))).toEqual([
      {
        kind: "program",
        id,
        field: "create",
        name: "Nouveau programme",
        schedule: DEFAULT_SCHEDULE,
        at: AT,
      },
      {
        kind: "programSession",
        id: seedId(0xf01),
        field: "create",
        name: null,
        programId: id,
        position: 0,
        at: AT,
      },
      { kind: "activeProgram", programId: id, at: AT },
    ]);
  });

  it("a new program from the start copies SEED's values with new ids", () => {
    // The account's starting program was edited: the new one starts from the shipped values.
    const edited = withSeed({ slots: [{ ...SEED.slots[0]!, sets: 9 }] });
    const changes = valid(
      newProgram(edited, { kind: "starter" }, "Programme de départ", ids(0xf00), AT),
    );
    const id = seedId(0xf00);
    expect(changes[0]).toMatchObject({
      kind: "program",
      field: "create",
      id,
      name: "Programme de départ",
    });
    expect(changes.at(-1)).toEqual({ kind: "activeProgram", programId: id, at: AT });
    const sessions = changes.filter((c) => c.kind === "programSession") as Extract<
      ProgramSessionChange,
      { field: "create" }
    >[];
    expect(sessions.map((s) => [s.programId, s.position])).toEqual(
      SEED.sessions.map((s) => [id, s.position]),
    );
    const slots = changes.filter((c) => c.kind === "programSlot") as Extract<
      ProgramSlotChange,
      { field: "create" }
    >[];
    expect(slots.map(valuesOf)).toEqual(SEED.slots.map(valuesOf));
    expect(slots.map((s) => [sessions.findIndex((x) => x.id === s.sessionId), s.position])).toEqual(
      SEED.slots.map((s) => [SEED.sessions.findIndex((x) => x.id === s.sessionId), s.position]),
    );
    const all = [...sessions, ...slots].map((c) => c.id);
    expect(new Set(all).size).toBe(all.length);
    expect(
      all.some((x) => SEED.sessions.some((s) => s.id === x) || SEED.slots.some((s) => s.id === x)),
    ).toBe(false);
  });

  it("a copy of the active program copies its live sessions and slots, not removed ones", () => {
    const state = withSeed({
      activeId: P2,
      programs: [prog(P2, { name: "Force" })],
      sessions: [
        session(X, { name: "Push" }),
        session(Y, { position: 1, removed: true }),
        session(Z, { programId: null }),
      ],
      slots: [
        slot(R(0), { sessionId: X }),
        slot(R(1), { sessionId: X, position: 1, removed: true }),
        slot(R(2), { sessionId: X, position: 0, rule: "no_climbing" }),
        slot(R(3), { sessionId: Y }),
      ],
    });
    const changes = valid(
      newProgram(state, { kind: "copy", from: P2 }, "Copie de Force", ids(0xf00), AT),
    );
    expect(changes).toMatchObject([
      { kind: "program", name: "Copie de Force" },
      {
        kind: "programSession",
        id: seedId(0xf01),
        name: "Push",
        programId: seedId(0xf00),
        position: 0,
      },
      { kind: "programSlot", sessionId: seedId(0xf01), rule: null, position: 0 },
      { kind: "programSlot", sessionId: seedId(0xf01), rule: "no_climbing", position: 0 },
      { kind: "activeProgram", programId: seedId(0xf00) },
    ]);
    expect(changes).toHaveLength(5);
    expect(
      newProgram(state, { kind: "copy", from: seedId(0xfff) }, "Copie", ids(0xf00), AT),
    ).toBeNull();
  });
});

describe("program order and removal", () => {
  const P3 = seedId(0xa03);
  const W = seedId(0xb04);
  const three = (activeId: string) =>
    withSeed({
      activeId,
      programs: [prog(P3), prog(P2)],
      sessions: [
        session(X),
        session(Y, { position: 1, removed: true }),
        session(Z, { programId: null }),
        session(W, { programId: P3 }),
      ],
    });

  it("lists the live programs in creation order, the starting one first", () => {
    const state = withSeed({
      programs: [prog(P3), prog(seedId(0xa04), { removed: true }), prog(P2)],
    });
    expect(programOrder(state).map((x) => x.id)).toEqual([SEED_PROGRAM_ID, P2, P3]);
    expect(neighbourOf(state, P2)).toBe(SEED_PROGRAM_ID);
    expect(neighbourOf(state, SEED_PROGRAM_ID)).toBe(P2);
    expect(neighbourOf(SEED, SEED_PROGRAM_ID)).toBeNull();
  });

  it("removing the active program points at the one listed before it, then flags it alone, pointer first", () => {
    // Its sessions keep their flags: a removed program hides them, and putting it back restores them.
    expect(valid(removeProgramFor(three(P2), P2, AT))).toEqual([
      { kind: "activeProgram", programId: SEED_PROGRAM_ID, at: AT },
      { kind: "program", id: P2, field: "removed", value: true, at: AT },
    ]);
  });

  it("removing the first program points at the next one", () => {
    expect(valid(removeProgramFor(three(SEED_PROGRAM_ID), SEED_PROGRAM_ID, AT))).toEqual([
      { kind: "activeProgram", programId: P2, at: AT },
      { kind: "program", id: SEED_PROGRAM_ID, field: "removed", value: true, at: AT },
    ]);
  });

  it("removing another program leaves the pointer alone", () => {
    expect(valid(removeProgramFor(three(SEED_PROGRAM_ID), P3, AT))).toEqual([
      { kind: "program", id: P3, field: "removed", value: true, at: AT },
    ]);
  });

  it("the last program is never removed", () => {
    expect(removeProgramFor(SEED, SEED_PROGRAM_ID, AT)).toBeNull();
    const one = withSeed({ programs: [prog(P2, { removed: true })] });
    expect(removeProgramFor(one, SEED_PROGRAM_ID, AT)).toBeNull();
    expect(removeProgramFor(one, P2, AT)).toBeNull();
  });
});

describe("removing and setting sessions aside", () => {
  const alone = withSeed({
    programs: [prog(P2)],
    sessions: [
      session(X),
      session(Y, { position: 1, removed: true }),
      session(Z, { programId: null }),
    ],
  });

  it("the last session of a rotation is never removed or set aside", () => {
    expect(removeSessionIn(alone, X, AT)).toBeNull();
    expect(setAside(alone, X, AT)).toBeNull();
    // A set-aside session can always go, even the last of the collection.
    expect(valid(removeSessionIn(alone, Z, AT))).toEqual(removeSession(Z, AT));
    expect(valid(removeSessionIn(alone, A, AT))).toEqual(removeSession(A, AT));
    expect(removeSessionIn(alone, NEW, AT)).toBeNull();
  });

  it("set aside then put back lands last of the active rotation", () => {
    const aside = valid(setAside(two, A, AT));
    expect(aside).toEqual(placeSession(two, A, null, 1, AT));
    const placed = (p: StoredPrograms, changes: readonly ProgramSessionChange[]) =>
      withSeed({
        ...p,
        sessions: p.sessions.map((s) => {
          const c = changes.find((x) => x.id === s.id && x.field === "place");
          return c && c.field === "place"
            ? { ...s, programId: c.programId, position: c.position }
            : s;
        }),
      });
    const after = placed(two, aside);
    expect(valid(putBack(after, A, AT))).toEqual([
      {
        kind: "programSession",
        id: A,
        field: "place",
        programId: SEED_PROGRAM_ID,
        position: 2,
        at: AT,
      },
    ]);
    expect(putBack(two, A, AT)).toBeNull(); // already in a rotation
    expect(setAside(two, Z, AT)).toBeNull(); // already set aside
    expect(putBack(withSeed({ ...after, activeId: null }), A, AT)).toBeNull();
  });
});

describe("groups", () => {
  it("chaining joins the next row's group, merges two groups, or makes a new key", () => {
    const fresh = ids(0xf00);
    expect(valid(chainWithNext(grouped, R(0), fresh, AT))).toEqual([group(R(0), "G")]);
    expect(valid(chainWithNext(grouped, R(3), fresh, AT))).toEqual([group(R(4), "G")]);
    expect(valid(chainWithNext(grouped, R(4), fresh, AT))).toEqual([group(R(4), "H")]);
    // The next row's key first: the whole group above takes it.
    const adjacent = withRows(rowsOf([null, "G", "G", "H", "H"]));
    expect(valid(chainWithNext(adjacent, R(2), fresh, AT))).toEqual([
      group(R(1), "H"),
      group(R(2), "H"),
    ]);
    const plain = withRows(rowsOf([null, null]));
    const key = seedId(0xf00).replace(/-/g, "").slice(-12);
    expect(valid(chainWithNext(plain, R(0), ids(0xf00), AT))).toEqual([
      group(R(0), key),
      group(R(1), key),
    ]);
  });

  it("chaining never takes a key another group of the section has", () => {
    // R(3) carries K alone while R(0) and R(1) are group K: the pair gets a new key.
    const shared = withRows(rowsOf(["K", "K", null, "K", null]));
    const key = seedId(0xf00).replace(/-/g, "").slice(-12);
    expect(valid(chainWithNext(shared, R(3), ids(0xf00), AT))).toEqual([
      group(R(3), key),
      group(R(4), key),
    ]);
  });

  it("a row chained, moved out, then chained again makes a second group; leaving the first stays by it", () => {
    const applied = (p: StoredPrograms, changes: readonly ProgramSlotChange[] | null) =>
      withSeed({
        ...p,
        slots: p.slots.map((s) =>
          valid(changes).reduce(
            (row, c) =>
              c.id !== row.id
                ? row
                : c.field === "position"
                  ? { ...row, position: c.value }
                  : c.field === "group"
                    ? { ...row, groupKey: c.value }
                    : row,
            s,
          ),
        ),
      });
    const fresh = ids(0xf00);
    let state = withRows(rowsOf([null, null, null, null, null, null, null]));
    for (const i of [1, 2, 3]) state = applied(state, chainWithNext(state, R(i), fresh, AT));
    // R(1) below R(5): the group keeps R(2) to R(4).
    state = applied(state, placeSlot(state, R(1), { rule: null, index: 5, groupKey: null }, AT));
    state = applied(state, chainWithNext(state, R(1), fresh, AT));
    const keyOf = (i: number) => state.slots.find((s) => s.id === R(i))!.groupKey;
    expect(keyOf(1)).toBe(keyOf(6));
    expect(keyOf(1)).not.toBe(keyOf(2));
    expect(valid(leaveGroup(state, R(3), AT))).toEqual([
      group(R(3), null),
      position(R(4), 2),
      position(R(3), 3),
    ]);
  });

  it("a group is its consecutive rows: the same key further down is another group", () => {
    const twice = withRows(rowsOf(["K", "K", "K", null, "K", "K"]));
    expect(valid(leaveGroup(twice, R(1), AT))).toEqual([
      group(R(1), null),
      position(R(2), 1),
      position(R(1), 2),
    ]);
    expect(valid(leaveGroup(twice, R(4), AT))).toEqual([group(R(4), null), group(R(5), null)]);
    expect(valid(leaveGroup(twice, R(0), AT))).toEqual([group(R(0), null)]);
    // Chained with the second, the row would also join the first: the second takes a new key.
    const key = seedId(0xf00).replace(/-/g, "").slice(-12);
    expect(valid(chainWithNext(twice, R(3), ids(0xf00), AT))).toEqual([
      group(R(3), key),
      group(R(4), key),
      group(R(5), key),
    ]);
  });

  it("chaining has no next row past the section's last, and nothing to write inside a group", () => {
    expect(chainWithNext(grouped, R(6), ids(0xf00), AT)).toBeNull();
    const sections = withRows([
      slot(R(0), { sessionId: X }),
      slot(R(1), { sessionId: X, rule: "no_climbing" }),
    ]);
    expect(chainWithNext(sections, R(0), ids(0xf00), AT)).toBeNull();
    expect(chainWithNext(grouped, R(1), ids(0xf00), AT)).toEqual([]);
    expect(chainWithNext(grouped, NEW, ids(0xf00), AT)).toBeNull();
  });

  it("leaving a middle row moves it below the group; a group left with one row is dissolved", () => {
    expect(valid(leaveGroup(grouped, R(2), AT))).toEqual([
      group(R(2), null),
      position(R(3), 2),
      position(R(2), 3),
    ]);
    expect(valid(leaveGroup(grouped, R(1), AT))).toEqual([group(R(1), null)]);
    expect(valid(leaveGroup(grouped, R(3), AT))).toEqual([group(R(3), null)]);
    expect(valid(leaveGroup(grouped, R(6), AT))).toEqual([group(R(6), null), group(R(5), null)]);
    expect(leaveGroup(grouped, R(0), AT)).toBeNull();
  });
});

describe("letter moves", () => {
  it("letter moves list only changed letters", () => {
    expect(letterMoves(["a", "b", "c", "d"], ["a", "c", "d"])).toEqual([
      { id: "c", from: "C", to: "B" },
      { id: "d", from: "D", to: "C" },
    ]);
    expect(letterMoves(["a", "b", "c"], ["c", "a", "b", "e"])).toEqual([
      { id: "c", from: "C", to: "A" },
      { id: "a", from: "A", to: "B" },
      { id: "b", from: "B", to: "C" },
    ]);
    expect(letterMoves(["a", "b"], ["a", "b", "c"])).toEqual([]);
  });
});

describe("two devices editing one slot (ED4, SY2)", () => {
  const T1 = "2026-10-25T08:00:00.000Z";
  const T2 = "2026-10-25T09:00:00.000Z";
  const counted = SEED.slots.find((s) => s.sessionId === A && s.measure === undefined)!;
  // The slot as the server stores it, never edited yet.
  const stored: ProgramSlotRow = {
    id: counted.id,
    sessionId: counted.sessionId,
    position: counted.position,
    positionAt: null,
    exerciseId: counted.exerciseId,
    measure: null,
    exerciseAt: null,
    repRange: [counted.repRange[0], counted.repRange[1]],
    repsAt: null,
    sets: counted.sets,
    setsAt: null,
    rirTarget: [counted.rirTarget[0], counted.rirTarget[1]],
    rirAt: null,
    restSec: counted.restSec,
    restAt: null,
    warmupSets: counted.warmupSets,
    warmupsAt: null,
    isMain: counted.isMain,
    mainAt: null,
    groupKey: counted.groupKey,
    groupAt: null,
    rule: counted.rule,
    ruleAt: null,
    removed: false,
    removedAt: null,
  };
  const merged = (changes: readonly ProgramSlotChange[]) =>
    changes.reduce((row, c) => mergeSlotChange(row, c) ?? row, stored);

  it("a range or warm-ups written for reps never land on a slot made timed meanwhile", () => {
    // Device A makes it timed at t1; device B, offline, still sees it counted and edits at t2.
    const toTimed = replaceExercise(SEED, counted.id, { id: "ds:2135", measure: "seconds" }, T1)!;
    const reps = editSlot(SEED, counted.id, { field: "reps", value: [8, 12] }, T2)!;
    const warmups = editSlot(SEED, counted.id, { field: "warmups", value: 3 }, T2)!;
    expect(toTimed).toHaveLength(1);
    const timed = { exerciseId: "ds:2135", measure: "seconds", repRange: [30, 60], warmupSets: 0 };
    for (const order of [
      [...toTimed, ...reps, ...warmups],
      [...reps, ...warmups, ...toTimed],
    ])
      expect(merged(order)).toMatchObject(timed);
    // Either way B's edits are refused or overwritten: the row goes back and B's phone reverts.
    const afterA = merged(toTimed);
    expect(mergeSlotChange(afterA, reps[0]!)).toBeNull();
    expect(mergeSlotChange(afterA, warmups[0]!)).toBeNull();
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
        editSlot(
          withSeed({ slots: [slot(NEW, { measure: "seconds", repRange: [30, 600] })] }),
          NEW,
          { field: "reps", value: [60, 900] },
          AT,
        ),
        editSlot(SEED, id, { field: "main", value: false }, AT),
        editSlot(SEED, id, { field: "group", value: "A1" }, AT),
        editSlot(SEED, id, { field: "rule", value: "no_climbing" }, AT),
        replaceExercise(SEED, id, { id: "ds:2135", measure: "seconds" }, AT),
        replaceExercise(SEED, id, { id: "ds:0047", measure: "reps" }, AT),
        moveSlot(SEED, id, 2, AT),
        removeSlot(SEED, id, AT),
        removeSlot(grouped, R(5), AT),
        copySlot(grouped, NEW, R(1), AT),
        copySession(SEED, C, "C (copie)", ids(0xf00), AT),
        copySlotsInto(two, Y, B, ids(0xf00), AT),
        newProgram(two, { kind: "empty" }, "Nouveau programme", ids(0xf00), AT),
        newProgram(two, { kind: "starter" }, "Programme de départ", ids(0xf00), AT),
        newProgram(grouped, { kind: "copy", from: P2 }, "Copie", ids(0xf00), AT),
        removeProgramFor(two, SEED_PROGRAM_ID, AT),
        removeSessionIn(two, Z, AT),
        setAside(two, A, AT),
        chainWithNext(grouped, R(4), ids(0xf00), AT),
        leaveGroup(grouped, R(2), AT),
      ] as (readonly Change[] | null)[]
    ).flatMap((changes): (Change | null)[] => (changes ? [...changes] : [null]));
    expect(built).not.toContain(null);
    expect(built.filter((c) => !isValidChange(c!))).toEqual([]);
  });
});
