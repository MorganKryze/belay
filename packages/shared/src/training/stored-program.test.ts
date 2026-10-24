import { describe, expect, it } from "vitest";
import { newId } from "../ids";
import { starterProgram } from "./program";
import {
  DAYS,
  DEFAULT_SCHEDULE,
  isPosition,
  isProgramName,
  isProgramSlot,
  isSchedule,
  isSeedSession,
  isSessionName,
  type LetteredTemplate,
  MAX_PROGRAMS,
  MAX_ROTATION,
  MAX_SESSIONS,
  nextInRotation,
  POSITION_MAX,
  type Program,
  PROGRAM_NAME_MAX,
  type ProgramSession,
  type ProgramSlot,
  rotationOf,
  SEED,
  SEED_PROGRAM_ID,
  seedId,
  SESSION_NAME_MAX,
  startedAs,
  type StoredPrograms,
  withSeed,
} from "./stored-program";

// The contract's UUID shape (z.uuid): versions 1 to 8, variant 8 to b.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const P1 = seedId(0xa01);
const P2 = seedId(0xa02);

const prog = (patch: Partial<Program> & { id: string }): Program => ({
  name: null,
  schedule: DEFAULT_SCHEDULE,
  removed: false,
  ...patch,
});
const session = (patch: Partial<ProgramSession> & { id: string }): ProgramSession => ({
  name: null,
  programId: P1,
  position: 0,
  removed: false,
  ...patch,
});
const slot = (patch: Partial<ProgramSlot> & { id: string; sessionId: string }): ProgramSlot => ({
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
  ...patch,
});
// Two programs, P1 active, and the sessions and slots given.
const stored = (
  sessions: ProgramSession[],
  slots: ProgramSlot[],
  patch: Partial<StoredPrograms> = {},
): StoredPrograms => ({
  activeId: P1,
  activeAt: null,
  programs: [prog({ id: P1 }), prog({ id: P2 })],
  sessions,
  slots,
  ...patch,
});
// n sessions in P1 at positions 0..n-1 (ids 0xb00 + i), each with one normal slot.
const sessionsOf = (n: number) => {
  const sessions = Array.from({ length: n }, (_, i) =>
    session({ id: seedId(0xb00 + i), position: i }),
  );
  return {
    sessions,
    slots: sessions.map((s, i) => slot({ id: seedId(0xc00 + i), sessionId: s.id })),
  };
};
// The template part of each rotation session, as the constant writes it.
const templates = (rotation: readonly LetteredTemplate[]) =>
  rotation.map(({ code, slots, noClimbing }) =>
    noClimbing ? { code, slots, noClimbing } : { code, slots },
  );

describe("the stored programs' bounds (PM11)", () => {
  it("allows 20 programs, 200 sessions, 26 per rotation, 60- and 40-character names, positions to 999, 7 days", () => {
    expect([MAX_PROGRAMS, MAX_SESSIONS, MAX_ROTATION, PROGRAM_NAME_MAX, SESSION_NAME_MAX]).toEqual([
      20, 200, 26, 60, 40,
    ]);
    expect([POSITION_MAX, DAYS]).toEqual([999, 7]);
    expect(DEFAULT_SCHEDULE).toEqual({ mode: "rotation", days: Array(7).fill(null) });
  });
});

describe("the starting program (SD1)", () => {
  it("the starting program is today's constant", () => {
    expect(templates(rotationOf(SEED))).toEqual(starterProgram);
    expect(rotationOf(SEED).map((t) => [t.code, t.sessionId, t.name])).toEqual([
      ["A", seedId(1), null],
      ["B", seedId(2), null],
      ["C", seedId(3), null],
    ]);
  });

  it("the seed program is active and holds A, B, C", () => {
    expect(SEED_PROGRAM_ID).toBe(seedId(0x10));
    expect(SEED.activeId).toBe(SEED_PROGRAM_ID);
    expect(SEED.activeAt).toBeNull();
    expect(SEED.programs).toEqual([
      { id: SEED_PROGRAM_ID, name: null, schedule: DEFAULT_SCHEDULE, removed: false },
    ]);
    expect(SEED.sessions).toEqual(
      [1, 2, 3].map((n, i) => ({
        id: seedId(n),
        name: null,
        programId: SEED_PROGRAM_ID,
        position: i,
        removed: false,
      })),
    );
  });

  it("gives frozen ids: the program 0x10, sessions 1 to 3, slots 0x101 on, C's no-climbing slots last", () => {
    expect(seedId(1)).toBe("00000000-0000-7000-8000-000000000001");
    const ofC = SEED.slots.filter((s) => s.sessionId === seedId(3));
    expect(ofC.map((s) => [s.id, s.rule, s.position])).toEqual([
      ...Array.from({ length: 8 }, (_, i) => [seedId(0x301 + i), null, i]),
      [seedId(0x309), "no_climbing", 0],
      [seedId(0x30a), "no_climbing", 1],
    ]);
    expect(SEED.slots.filter((s) => s.sessionId === seedId(1)).map((s) => s.id)).toEqual(
      Array.from({ length: 6 }, (_, i) => seedId(0x101 + i)),
    );
    expect(SEED.slots.filter((s) => s.sessionId === seedId(2)).map((s) => s.id)).toEqual(
      Array.from({ length: 7 }, (_, i) => seedId(0x201 + i)),
    );
    expect(SEED.slots.every(isProgramSlot)).toBe(true);
  });

  it("seed ids are valid UUIDs, distinct, and never a newId", () => {
    const ids = [...SEED.programs, ...SEED.sessions, ...SEED.slots].map((r) => r.id);
    expect(ids).toHaveLength(1 + 3 + 6 + 7 + 10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(UUID);
      expect(id.startsWith("00000000-0000-")).toBe(true); // a zero time part
    }
    expect(newId().startsWith("00000000-0000-")).toBe(false);
  });

  it("isSeedSession knows the three starting sessions only", () => {
    expect([1, 2, 3].map((n) => isSeedSession(seedId(n)))).toEqual([true, true, true]);
    expect(isSeedSession(seedId(4))).toBe(false);
    expect(isSeedSession(SEED_PROGRAM_ID)).toBe(false);
    expect(isSeedSession(newId())).toBe(false);
  });
});

describe("withSeed (SD3)", () => {
  it("a stored row wins over the seed, a missing one reads as the seed", () => {
    expect(withSeed({})).toEqual(SEED);
    const renamed = { ...SEED.sessions[1]!, name: "Jambes" };
    const heavier = { ...SEED.slots[0]!, sets: 5 };
    const added = slot({ id: newId(), sessionId: seedId(1), position: 6 });
    const named = { ...SEED.programs[0]!, name: "Hiver" };
    const other = prog({ id: P2 });
    const out = withSeed({
      programs: [named, other],
      sessions: [renamed],
      slots: [heavier, added],
    });
    expect(out.activeId).toBe(SEED_PROGRAM_ID);
    expect(out.programs).toEqual([named, other]);
    expect(out.sessions).toHaveLength(3);
    expect(out.sessions.find((s) => s.id === seedId(2))).toEqual(renamed);
    expect(out.slots).toHaveLength(SEED.slots.length + 1);
    expect(out.slots.find((s) => s.id === seedId(0x101))!.sets).toBe(5);
    expect(out.slots.filter((s) => s.id === seedId(0x101))).toHaveLength(1);
    expect(out.slots).toContainEqual(added);
    expect(rotationOf(out)[0]!.slots.at(-1)).toEqual({
      exerciseId: "ds:0025",
      sets: 3,
      repRange: [8, 12],
      rirTarget: [1, 2],
      restSec: 90,
      warmupSets: 0,
      isMain: false,
      groupKey: null,
    });
  });

  it("a stored active pointer wins, with its time", () => {
    const at = "2026-10-20T08:00:00.000Z";
    const out = withSeed({ activeId: P2, activeAt: at, programs: [prog({ id: P2 })] });
    expect([out.activeId, out.activeAt]).toEqual([P2, at]);
  });
});

describe("rotationOf (PM4, PM6, PM7, PM9, PM12)", () => {
  it("sessions and slots sort by position then id", () => {
    const [x, y, z] = ["00000000-0000-7000-8000-00000000000a", seedId(0xb), seedId(0xc)];
    const out = rotationOf(
      stored(
        [
          session({ id: z, position: 0 }),
          session({ id: y, position: 1 }),
          session({ id: x, position: 1 }),
        ],
        [
          slot({ id: seedId(0x2), sessionId: y, exerciseId: "ds:0002", position: 1 }),
          slot({ id: seedId(0x3), sessionId: y, exerciseId: "ds:0003", position: 0 }),
          slot({ id: seedId(0x1), sessionId: y, exerciseId: "ds:0001", position: 1 }),
          slot({ id: seedId(0x4), sessionId: y, exerciseId: "ds:0004", rule: "no_climbing" }),
          slot({ id: seedId(0x5), sessionId: x }),
          slot({ id: seedId(0x6), sessionId: z, measure: "seconds", repRange: [30, 60] }),
        ],
      ),
    );
    expect(out.map((s) => [s.code, s.sessionId])).toEqual([
      ["A", z],
      ["B", x],
      ["C", y],
    ]);
    expect(out[0]!.slots[0]!.measure).toBe("seconds");
    expect(out[0]!.noClimbing).toBeUndefined();
    expect(out[2]!.slots.map((s) => s.exerciseId)).toEqual(["ds:0003", "ds:0001", "ds:0002"]);
    expect(out[2]!.noClimbing!.map((s) => [s.exerciseId, s.rule])).toEqual([
      ["ds:0004", undefined],
    ]);
  });

  it("letters follow the rotation order and move with a reorder", () => {
    const { sessions, slots } = sessionsOf(4);
    const before = rotationOf(stored(sessions, slots));
    expect(before.map((t) => t.code).join("")).toBe("ABCD");
    expect(before.map((t) => t.sessionId)).toEqual(sessions.map((s) => s.id));
    // The last one moves first: it becomes A, the others shift by one letter.
    const moved = sessions.map((s, i) => ({ ...s, position: i === 3 ? 0 : i + 1 }));
    const after = rotationOf(stored(moved, slots));
    expect(after.map((t) => [t.code, t.sessionId])).toEqual([
      ["A", sessions[3]!.id],
      ["B", sessions[0]!.id],
      ["C", sessions[1]!.id],
      ["D", sessions[2]!.id],
    ]);
  });

  it("a set-aside session and another program's session get no letter", () => {
    const { sessions, slots } = sessionsOf(4);
    const placed = [
      sessions[0]!,
      { ...sessions[1]!, programId: null }, // set aside
      { ...sessions[2]!, programId: P2 },
      sessions[3]!,
    ];
    const out = rotationOf(stored(placed, slots));
    expect(out.map((t) => [t.code, t.sessionId])).toEqual([
      ["A", sessions[0]!.id],
      ["B", sessions[3]!.id],
    ]);
  });

  it("a session with no normal slot is skipped and the letters close up", () => {
    const { sessions, slots } = sessionsOf(5);
    const out = rotationOf(
      stored(
        [...sessions.slice(0, 4), { ...sessions[4]!, removed: true }],
        [
          { ...slots[0]!, removed: true }, // its only slot removed
          slots[1]!,
          { ...slots[2]!, rule: "no_climbing" }, // only a no-climbing slot
          slots[3]!,
          slots[4]!, // of a removed session
        ],
      ),
    );
    expect(out.map((t) => [t.code, t.sessionId])).toEqual([
      ["A", sessions[1]!.id],
      ["B", sessions[3]!.id],
    ]);
  });

  it("the 27th session of a rotation is not offered", () => {
    const { sessions, slots } = sessionsOf(27);
    const out = rotationOf(stored(sessions, slots));
    expect(out).toHaveLength(26);
    expect(out.map((t) => t.code).join("")).toBe(LETTERS);
    expect(out.map((t) => t.sessionId)).not.toContain(sessions[26]!.id);
  });

  it("names follow their session", () => {
    const { sessions, slots } = sessionsOf(2);
    const out = rotationOf(stored([{ ...sessions[0]!, name: "Haut" }, sessions[1]!], slots));
    expect(out.map((t) => t.name)).toEqual(["Haut", null]);
  });

  it("only the active program's rotation is offered; none for a missing or removed one", () => {
    const { sessions, slots } = sessionsOf(3);
    const split = [sessions[0]!, { ...sessions[1]!, programId: P2 }, sessions[2]!];
    expect(rotationOf(stored(split, slots, { activeId: P2 })).map((t) => t.sessionId)).toEqual([
      sessions[1]!.id,
    ]);
    expect(rotationOf(stored(split, slots, { activeId: null }))).toEqual([]);
    expect(rotationOf(stored(split, slots, { activeId: newId() }))).toEqual([]);
    const removed = [prog({ id: P1, removed: true }), prog({ id: P2 })];
    expect(rotationOf(stored(split, slots, { programs: removed }))).toEqual([]);
  });
});

describe("nextInRotation (PM10)", () => {
  const { sessions, slots } = sessionsOf(4);
  const rotation = rotationOf(stored(sessions, slots));
  const idOf = (i: number) => sessions[i]!.id;
  let day = 1;
  // A session finished, one day later than the one before.
  const done = (patch: {
    id?: string;
    sessionCode?: string;
    sessionId?: string | null;
    startedAt?: string;
  }) => {
    const startedAt = patch.startedAt ?? `2026-10-${String(day++).padStart(2, "0")}T17:00:00.000Z`;
    return {
      id: newId(),
      sessionCode: "A",
      startedAt,
      endedAt: startedAt,
      removed: false,
      ...patch,
    };
  };

  it("the next session follows the last one's recorded id, whenever it was started, then its letter for an old session", () => {
    expect(nextInRotation([], rotation, null)!.sessionId).toBe(idOf(0));
    // By its recorded id, whatever letter it had.
    expect(
      nextInRotation([done({ sessionCode: "A", sessionId: idOf(2) })], rotation, null)!.code,
    ).toBe("D");
    expect(
      nextInRotation([done({ sessionCode: "C", sessionId: idOf(3) })], rotation, null)!.code,
    ).toBe("A");
    // An old session with no id: by its letter.
    expect(nextInRotation([done({ sessionCode: "B" })], rotation, null)!.code).toBe("C");
    expect(
      nextInRotation([done({ sessionCode: "B", sessionId: null })], rotation, null)!.code,
    ).toBe("C");
    // The latest finished one counts; one in progress or removed does not.
    const history = [
      done({ sessionId: idOf(0), startedAt: "2026-10-05T17:00:00.000Z" }),
      done({ sessionId: idOf(1), startedAt: "2026-10-07T17:00:00.000Z" }),
      { ...done({ sessionId: idOf(2), startedAt: "2026-10-08T17:00:00.000Z" }), endedAt: null },
      { ...done({ sessionId: idOf(3), startedAt: "2026-10-09T17:00:00.000Z" }), removed: true },
    ];
    expect(nextInRotation(history, rotation, null)!.sessionId).toBe(idOf(2));
    // A recorded session counts even when started before the program became active.
    expect(nextInRotation(history, rotation, "2026-10-08T00:00:00.000Z")!.sessionId).toBe(idOf(2));
  });

  it("of two sessions started at the same instant, the one with the greater id counts on every device", () => {
    const startedAt = "2026-10-10T17:00:00.000Z";
    const first = done({ id: seedId(0xf01), sessionId: idOf(0), startedAt });
    const second = done({ id: seedId(0xf02), sessionId: idOf(1), startedAt });
    expect(nextInRotation([first, second], rotation, null)!.sessionId).toBe(idOf(2));
    expect(nextInRotation([second, first], rotation, null)!.sessionId).toBe(idOf(2));
  });

  it("a recorded session that left the rotation, or a letter it lacks, gives the first", () => {
    expect(
      nextInRotation([done({ sessionCode: "A", sessionId: newId() })], rotation, null)!.code,
    ).toBe("A");
    expect(nextInRotation([done({ sessionCode: "F" })], rotation, null)!.code).toBe("A");
  });

  it("after a switch the next session follows the last one done when the new rotation holds it, else the first", () => {
    // The other program's rotation: sessions 0 and 1; sessions 2 and 3 stay in the first program.
    const other = rotationOf(
      stored(
        sessions.map((s, i) => (i < 2 ? { ...s, programId: P2 } : s)),
        slots,
        { activeId: P2, activeAt: "2026-10-20T08:00:00.000Z" },
      ),
    );
    const before = [done({ sessionId: idOf(0), startedAt: "2026-10-19T17:00:00.000Z" })];
    expect(nextInRotation(before, other, "2026-10-20T08:00:00.000Z")!.sessionId).toBe(idOf(1));
    const elsewhere = [done({ sessionId: idOf(2), startedAt: "2026-10-19T17:00:00.000Z" })];
    expect(nextInRotation(elsewhere, other, "2026-10-20T08:00:00.000Z")!.sessionId).toBe(idOf(0));
    const since = [
      ...elsewhere,
      done({ sessionId: idOf(0), startedAt: "2026-10-21T17:00:00.000Z" }),
    ];
    expect(nextInRotation(since, other, "2026-10-20T08:00:00.000Z")!.sessionId).toBe(idOf(1));
  });

  it("switching away and back with no session in between offers the same next session", () => {
    const history = [done({ sessionId: idOf(1), startedAt: "2026-10-19T17:00:00.000Z" })];
    expect(nextInRotation(history, rotation, null)!.sessionId).toBe(idOf(2));
    const other = rotationOf(
      stored(
        sessions.map((s, i) => (i === 3 ? { ...s, programId: P2 } : s)),
        slots,
        { activeId: P2, activeAt: "2026-10-20T08:00:00.000Z" },
      ),
    );
    expect(nextInRotation(history, other, "2026-10-20T08:00:00.000Z")!.sessionId).toBe(idOf(3));
    // Back to the first program a minute later: the same session as before the switch.
    expect(nextInRotation(history, rotation, "2026-10-20T08:01:00.000Z")!.sessionId).toBe(idOf(2));
  });

  it("a session recorded before ids counts by letter only since activation", () => {
    const old = [done({ sessionCode: "B", startedAt: "2026-10-07T17:00:00.000Z" })];
    expect(nextInRotation(old, rotation, null)!.code).toBe("C");
    expect(nextInRotation(old, rotation, "2026-10-08T00:00:00.000Z")!.code).toBe("A");
    // Started exactly when it became active counts, in any offset.
    expect(nextInRotation(old, rotation, "2026-10-07T19:00:00.000+02:00")!.code).toBe("C");
    // Left out before activation, it no longer hides an earlier session that recorded its own.
    const mixed = [
      done({ sessionId: idOf(0), startedAt: "2026-10-05T17:00:00.000Z" }),
      done({ sessionCode: "C", sessionId: null, startedAt: "2026-10-07T17:00:00.000Z" }),
    ];
    expect(nextInRotation(mixed, rotation, "2026-10-08T00:00:00.000Z")!.sessionId).toBe(idOf(1));
    expect(nextInRotation(mixed, rotation, null)!.sessionId).toBe(idOf(3));
  });

  it("an empty rotation offers none", () => {
    expect(nextInRotation([], [], null)).toBeNull();
    expect(nextInRotation([done({ sessionId: idOf(0) })], [], null)).toBeNull();
  });
});

describe("startedAs", () => {
  const { sessions, slots } = sessionsOf(3);
  const [a, b] = rotationOf(stored(sessions, slots));

  it("a session done is a rotation session by the id it recorded, whatever letter it had", () => {
    expect(startedAs({ sessionCode: "B", sessionId: a!.sessionId }, a!)).toBe(true);
    expect(startedAs({ sessionCode: "A", sessionId: b!.sessionId }, a!)).toBe(false);
    expect(startedAs({ sessionCode: "A", sessionId: newId() }, a!)).toBe(false);
  });

  it("one recorded before sessions kept their id is the session now at its letter", () => {
    expect(startedAs({ sessionCode: "A" }, a!)).toBe(true);
    expect(startedAs({ sessionCode: "A", sessionId: null }, a!)).toBe(true);
    expect(startedAs({ sessionCode: "B" }, a!)).toBe(false);
  });
});

describe("validators", () => {
  it("isSchedule takes rotation and fixed weeks of session ids and refuses 6 or 8 days, letters, other modes", () => {
    expect(isSchedule(DEFAULT_SCHEDULE)).toBe(true);
    const fixed = [seedId(1), null, seedId(2), null, seedId(3), newId(), null];
    expect(isSchedule({ mode: "fixed", days: fixed })).toBe(true);
    expect(isSchedule({ mode: "fixed", days: Array(6).fill(null) })).toBe(false);
    expect(isSchedule({ mode: "rotation", days: Array(8).fill(null) })).toBe(false);
    expect(isSchedule({ mode: "fixed", days: ["A", null, null, null, null, null, null] })).toBe(
      false,
    );
    const upper = "0192A3B4-C5D6-7E8F-9A0B-C1D2E3F4A5B6";
    expect(isSchedule({ mode: "fixed", days: [upper.toLowerCase(), ...fixed.slice(1)] })).toBe(
      true,
    );
    expect(isSchedule({ mode: "fixed", days: [upper, ...fixed.slice(1)] })).toBe(false);
    expect(isSchedule({ mode: "fixed", days: [3, null, null, null, null, null, null] })).toBe(
      false,
    );
    expect(isSchedule({ mode: "weekly", days: Array(7).fill(null) })).toBe(false);
    expect(isSchedule({ mode: "rotation" })).toBe(false);
    expect(isSchedule(null)).toBe(false);
  });

  it("isSessionName takes null and 1 to 40 characters, never a control character", () => {
    expect(isSessionName(null)).toBe(true);
    expect(isSessionName("P")).toBe(true);
    expect(isSessionName("x".repeat(40))).toBe(true);
    expect(isSessionName("Séance d'été")).toBe(true);
    expect(isSessionName("x".repeat(41))).toBe(false);
    expect(isSessionName("")).toBe(false);
    expect(isSessionName(" Jambes")).toBe(false);
    expect(isSessionName("Jambes ")).toBe(false);
    for (const c of ["\u0000", "\u0007", "\n", "\u007f", "\u009f"])
      expect(isSessionName(`Haut${c}bas`), JSON.stringify(c)).toBe(false);
    expect(isSessionName(undefined)).toBe(false);
    expect(isSessionName(4)).toBe(false);
  });

  it("isProgramName takes null and 1 to 60 characters, never a control character", () => {
    expect(isProgramName(null)).toBe(true);
    expect(isProgramName("H")).toBe(true);
    expect(isProgramName("x".repeat(60))).toBe(true);
    expect(isProgramName("x".repeat(61))).toBe(false);
    expect(isProgramName("")).toBe(false);
    expect(isProgramName(" Hiver")).toBe(false);
    expect(isProgramName("Hiver\u0000")).toBe(false);
    expect(isProgramName("Hi\tver")).toBe(false);
    expect(isProgramName(undefined)).toBe(false);
    expect(isProgramName(60)).toBe(false);
  });

  it("isPosition takes an integer from 0 to 999", () => {
    expect([0, 999].every(isPosition)).toBe(true);
    expect([-1, 1000, 1.5, "1", null].some(isPosition)).toBe(false);
  });

  it("isProgramSlot refuses added, skipped, an unknown rule, a timed range past 3600", () => {
    const ok = slot({ id: seedId(0x101), sessionId: seedId(1) });
    expect(isProgramSlot(ok)).toBe(true);
    expect(isProgramSlot({ ...ok, rule: "no_climbing" })).toBe(true);
    expect(isProgramSlot({ ...ok, measure: "seconds", repRange: [30, 3600] })).toBe(true);
    expect(isProgramSlot({ ...ok, added: true })).toBe(false);
    expect(isProgramSlot({ ...ok, skipped: false })).toBe(false);
    expect(isProgramSlot({ ...ok, rule: "rain" })).toBe(false);
    expect(isProgramSlot({ ...ok, rule: undefined })).toBe(false);
    expect(isProgramSlot({ ...ok, measure: "seconds", repRange: [30, 3601] })).toBe(false);
    expect(isProgramSlot({ ...ok, sets: 11 })).toBe(false);
    expect(isProgramSlot(null)).toBe(false);
  });
});
