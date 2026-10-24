// The program as each account stores it: sessions, their slots and a schedule, as rows that sync
// field by field. Zod-free: the phone reads it at startup, before any schema is loaded.
import { type SessionTemplate, starterProgram } from "./program";
import { isSessionCode, isSlot, type Slot } from "./workout";

// The editor's range (owner, 2026-10-25); the server never refuses a program past it.
export const MAX_LIVE_SESSIONS = 7;
export const SESSION_NAME_MAX = 40;
export const POSITION_MAX = 999;
export const DAYS = 7; // a schedule's days, Monday first

export interface Schedule {
  mode: "rotation" | "fixed";
  days: readonly (string | null)[];
}
export const DEFAULT_SCHEDULE: Schedule = { mode: "rotation", days: Array(DAYS).fill(null) };

export interface ProgramSession {
  id: string;
  code: string; // fixed at creation, never reused while letters remain (PM10)
  name: string | null;
  position: number;
  removed: boolean;
}

export interface ProgramSlot extends Omit<Slot, "rule" | "added" | "skipped"> {
  id: string;
  sessionId: string;
  position: number; // within its section: normal slots, or the no-climbing ones
  rule: "no_climbing" | null;
  removed: boolean;
}

export interface StoredProgram {
  schedule: Schedule;
  sessions: readonly ProgramSession[];
  slots: readonly ProgramSlot[];
}

// The starting program's ids, the same for every account: a version 7 shape with a zero time part,
// so a generated id never collides with one. Sessions A, B, C are 1, 2, 3; session k's slots
// start at k·0x100 + 1, normal ones first, then the no-climbing ones. Once shipped these ids are
// frozen forever, like the starting program itself: phones and the server match rows by them.
export const seedId = (n: number): string =>
  "00000000-0000-7000-8000-" + n.toString(16).padStart(12, "0");

function seedOf(templates: readonly SessionTemplate[]): StoredProgram {
  const sessions: ProgramSession[] = [];
  const slots: ProgramSlot[] = [];
  templates.forEach((t, i) => {
    const sessionId = seedId(i + 1);
    sessions.push({ id: sessionId, code: t.code, name: null, position: i, removed: false });
    const section = (list: readonly Slot[], from: number, rule: ProgramSlot["rule"]) =>
      list.forEach((s, j) =>
        slots.push({
          ...s,
          id: seedId((i + 1) * 0x100 + from + j + 1),
          sessionId,
          position: j,
          rule,
          removed: false,
        }),
      );
    section(t.slots, 0, null);
    section(t.noClimbing ?? [], t.slots.length, "no_climbing");
  });
  return { schedule: DEFAULT_SCHEDULE, sessions, slots };
}

// Built from the constant, so the two can never drift apart (SD1).
export const SEED: StoredProgram = seedOf(starterProgram);

// Stored rows win by id; every seed row the device lacks is read from SEED (SD3).
function overlay<T extends { id: string }>(seed: readonly T[], stored: readonly T[]): T[] {
  const byId = new Map(stored.map((r) => [r.id, r]));
  const seedIds = new Set(seed.map((r) => r.id));
  return [...seed.map((r) => byId.get(r.id) ?? r), ...stored.filter((r) => !seedIds.has(r.id))];
}

export const withSeed = (stored: Partial<StoredProgram>): StoredProgram => ({
  schedule: stored.schedule ?? SEED.schedule,
  sessions: overlay(SEED.sessions, stored.sessions ?? []),
  slots: overlay(SEED.slots, stored.slots ?? []),
});

// By position, then by id so every device reads two equal positions in the same order (PM4).
const byPosition = (a: { position: number; id: string }, b: { position: number; id: string }) =>
  a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const toSlot = (s: ProgramSlot): Slot => {
  const out: Slot = {
    exerciseId: s.exerciseId,
    sets: s.sets,
    repRange: s.repRange,
    rirTarget: s.rirTarget,
    restSec: s.restSec,
    warmupSets: s.warmupSets,
    isMain: s.isMain,
    groupKey: s.groupKey,
  };
  if (s.measure === "seconds") out.measure = "seconds";
  return out;
};

// Live sessions in order, each with its normal slots, then its no-climbing slots as the template's
// conditional rule (planFor marks them). A session with no live normal slot cannot be started, so
// it is left out of the rotation and of every list (PM6, PM7).
export function templatesOf(program: StoredProgram): SessionTemplate[] {
  const live = program.slots.filter((s) => !s.removed).sort(byPosition);
  return program.sessions
    .filter((s) => !s.removed)
    .sort(byPosition)
    .flatMap((session): SessionTemplate[] => {
      const own = live.filter((s) => s.sessionId === session.id);
      const slots = own.filter((s) => s.rule === null).map(toSlot);
      if (slots.length === 0) return [];
      const noClimbing = own.filter((s) => s.rule === "no_climbing").map(toSlot);
      return [
        noClimbing.length > 0
          ? { code: session.code, slots, noClimbing }
          : { code: session.code, slots },
      ];
    });
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// PM10: the first letter no session ever had, so past sessions keep pointing at their own; once all
// 26 are used, the first letter no live session holds; null when 26 live sessions hold them all.
export function nextCode(
  sessions: readonly Pick<ProgramSession, "code" | "removed">[],
): string | null {
  const used = new Set(sessions.map((s) => s.code));
  const held = new Set(sessions.filter((s) => !s.removed).map((s) => s.code));
  return [...LETTERS].find((c) => !used.has(c)) ?? [...LETTERS].find((c) => !held.has(c)) ?? null;
}

// Null, or 1 to 40 characters with no space at either end (counted in UTF-16 units, as notes).
export const isSessionName = (v: unknown): v is string | null =>
  v === null ||
  (typeof v === "string" && v.length >= 1 && v.length <= SESSION_NAME_MAX && v === v.trim());

export const isPosition = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= POSITION_MAX;

export const isSchedule = (v: unknown): v is Schedule => {
  const s = v as Record<string, unknown>;
  return (
    typeof s === "object" &&
    s !== null &&
    (s.mode === "rotation" || s.mode === "fixed") &&
    Array.isArray(s.days) &&
    s.days.length === DAYS &&
    s.days.every((d) => d === null || (typeof d === "string" && isSessionCode(d)))
  );
};

// A slot's values within today's bounds; a program slot is never added or skipped (those belong
// to one session's copy), and its rule is stored as null rather than left out.
export function isProgramSlot(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  if (s.rule !== null && s.rule !== "no_climbing") return false;
  if ("added" in s || "skipped" in s) return false;
  return isSlot({ ...s, rule: undefined });
}
