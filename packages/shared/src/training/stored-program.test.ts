import { describe, expect, it } from "vitest";
import { newId } from "../ids";
import { starterProgram } from "./program";
import {
  DAYS,
  DEFAULT_SCHEDULE,
  isPosition,
  isProgramSlot,
  isSchedule,
  isSessionName,
  MAX_LIVE_SESSIONS,
  nextCode,
  POSITION_MAX,
  type ProgramSession,
  type ProgramSlot,
  SEED,
  seedId,
  SESSION_NAME_MAX,
  type StoredProgram,
  templatesOf,
  withSeed,
} from "./stored-program";

// The contract's UUID shape (z.uuid): versions 1 to 8, variant 8 to b.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const session = (patch: Partial<ProgramSession> & { id: string }): ProgramSession => ({
  code: "A",
  name: null,
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
const program = (sessions: ProgramSession[], slots: ProgramSlot[]): StoredProgram => ({
  schedule: DEFAULT_SCHEDULE,
  sessions,
  slots,
});

describe("the stored program's bounds", () => {
  it("holds 7 live sessions in the editor, 40-character names, positions to 999, 7 days", () => {
    expect([MAX_LIVE_SESSIONS, SESSION_NAME_MAX, POSITION_MAX, DAYS]).toEqual([7, 40, 999, 7]);
    expect(DEFAULT_SCHEDULE).toEqual({ mode: "rotation", days: Array(7).fill(null) });
  });
});

describe("the starting program (SD1)", () => {
  it("the starting program is today's constant", () => {
    expect(templatesOf(SEED)).toEqual(starterProgram);
    expect(SEED.schedule).toEqual(DEFAULT_SCHEDULE);
    expect(SEED.sessions.map((s) => [s.code, s.name, s.position, s.removed])).toEqual([
      ["A", null, 0, false],
      ["B", null, 1, false],
      ["C", null, 2, false],
    ]);
  });

  it("gives frozen ids: sessions 1 to 3, slots 0x101 on, C's no-climbing slots last", () => {
    expect(seedId(1)).toBe("00000000-0000-7000-8000-000000000001");
    expect(SEED.sessions.map((s) => s.id)).toEqual([seedId(1), seedId(2), seedId(3)]);
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
    const ids = [...SEED.sessions, ...SEED.slots].map((r) => r.id);
    expect(ids).toHaveLength(3 + 6 + 7 + 10);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(UUID);
      expect(id.startsWith("00000000-0000-")).toBe(true); // a zero time part
    }
    expect(newId().startsWith("00000000-0000-")).toBe(false);
  });
});

describe("withSeed (SD3)", () => {
  it("a stored row wins over the seed, a missing one reads as the seed", () => {
    expect(withSeed({})).toEqual(SEED);
    const renamed = { ...SEED.sessions[1]!, name: "Jambes" };
    const heavier = { ...SEED.slots[0]!, sets: 5 };
    const added = slot({ id: newId(), sessionId: seedId(1), position: 6 });
    const schedule = { mode: "fixed" as const, days: ["A", null, "B", null, "C", null, null] };
    const out = withSeed({ schedule, sessions: [renamed], slots: [heavier, added] });
    expect(out.schedule).toEqual(schedule);
    expect(out.sessions).toHaveLength(3);
    expect(out.sessions.find((s) => s.id === seedId(2))).toEqual(renamed);
    expect(out.slots).toHaveLength(SEED.slots.length + 1);
    expect(out.slots.find((s) => s.id === seedId(0x101))!.sets).toBe(5);
    expect(out.slots.filter((s) => s.id === seedId(0x101))).toHaveLength(1);
    expect(out.slots).toContainEqual(added);
    expect(templatesOf(out)[0]!.slots.at(-1)).toEqual({
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
});

describe("templatesOf (PM4, PM6, PM7)", () => {
  it("sessions and slots sort by position then id", () => {
    const [x, y, z] = ["00000000-0000-7000-8000-00000000000a", seedId(0xb), seedId(0xc)];
    const out = templatesOf(
      program(
        [
          session({ id: z, code: "D", position: 0 }),
          session({ id: y, code: "B", position: 1 }),
          session({ id: x, code: "E", position: 1 }),
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
    expect(out.map((s) => s.code)).toEqual(["D", "E", "B"]);
    expect(out[0]!.slots[0]!.measure).toBe("seconds");
    expect(out[0]!.noClimbing).toBeUndefined();
    expect(out[2]!.slots.map((s) => s.exerciseId)).toEqual(["ds:0003", "ds:0001", "ds:0002"]);
    expect(out[2]!.noClimbing!.map((s) => [s.exerciseId, s.rule])).toEqual([
      ["ds:0004", undefined],
    ]);
  });

  it("a removed session, a removed slot and a session with only no-climbing slots are left out", () => {
    const out = templatesOf(
      program(
        [
          session({ id: seedId(1), code: "A" }),
          session({ id: seedId(2), code: "B", position: 1, removed: true }),
          session({ id: seedId(3), code: "C", position: 2 }),
          session({ id: seedId(4), code: "D", position: 3 }),
          session({ id: seedId(5), code: "E", position: 4 }),
        ],
        [
          slot({ id: seedId(0x101), sessionId: seedId(1) }),
          slot({ id: seedId(0x102), sessionId: seedId(1), position: 1, removed: true }),
          slot({ id: seedId(0x201), sessionId: seedId(2) }),
          slot({ id: seedId(0x301), sessionId: seedId(3), rule: "no_climbing" }),
          slot({ id: seedId(0x401), sessionId: seedId(4), removed: true }),
        ],
      ),
    );
    expect(out.map((s) => s.code)).toEqual(["A"]);
    expect(out[0]!.slots).toHaveLength(1);
  });
});

describe("nextCode (PM10)", () => {
  const live = (codes: string, removed = false) => [...codes].map((code) => ({ code, removed }));
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  it("nextCode gives D after A, B, C, never a removed letter while letters remain, then the first letter no live session holds, then null", () => {
    expect(nextCode([])).toBe("A");
    expect(nextCode(live("ABC"))).toBe("D");
    expect(nextCode([...live("ABC"), ...live("D", true)])).toBe("E");
    expect(nextCode([...live("BC"), ...live("A", true)])).toBe("D");
    expect(nextCode([...live(LETTERS.slice(0, 25), true), ...live("Z")])).toBe("A");
    expect(nextCode([...live("AB"), ...live(LETTERS.slice(2), true)])).toBe("C");
    expect(nextCode(live(LETTERS))).toBeNull();
  });
});

describe("validators", () => {
  it("isSchedule takes rotation and fixed weeks and refuses 6 or 8 days, lower-case letters, other modes", () => {
    expect(isSchedule(DEFAULT_SCHEDULE)).toBe(true);
    expect(isSchedule({ mode: "fixed", days: ["A", null, "B", null, "C", "D", null] })).toBe(true);
    expect(isSchedule({ mode: "fixed", days: Array(6).fill(null) })).toBe(false);
    expect(isSchedule({ mode: "rotation", days: Array(8).fill(null) })).toBe(false);
    expect(isSchedule({ mode: "fixed", days: ["a", null, null, null, null, null, null] })).toBe(
      false,
    );
    expect(isSchedule({ mode: "fixed", days: ["AB", null, null, null, null, null, null] })).toBe(
      false,
    );
    expect(isSchedule({ mode: "weekly", days: Array(7).fill(null) })).toBe(false);
    expect(isSchedule({ mode: "rotation" })).toBe(false);
    expect(isSchedule(null)).toBe(false);
  });

  it("isSessionName takes null and 1 to 40 characters", () => {
    expect(isSessionName(null)).toBe(true);
    expect(isSessionName("P")).toBe(true);
    expect(isSessionName("x".repeat(40))).toBe(true);
    expect(isSessionName("x".repeat(41))).toBe(false);
    expect(isSessionName("")).toBe(false);
    expect(isSessionName(" Jambes")).toBe(false);
    expect(isSessionName("Jambes ")).toBe(false);
    expect(isSessionName(undefined)).toBe(false);
    expect(isSessionName(4)).toBe(false);
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
