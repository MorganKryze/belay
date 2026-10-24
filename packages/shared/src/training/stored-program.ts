// The programs as each account stores them: programs, the active one, sessions placed in a
// program's rotation or set aside, their slots, as rows that sync field by field. Zod-free: the
// phone reads it at startup, before any schema is loaded.
import { type SessionTemplate, starterProgram } from "./program";
import { isSlot, type Slot } from "./workout";

// Limits against abuse only, never a product cap (PM11): the storage one account may hold. A
// rotation stops at 26 because a session done stores its letter as one capital (isSessionCode).
export const MAX_PROGRAMS = 20;
export const MAX_SESSIONS = 200;
export const MAX_ROTATION = 26;
export const PROGRAM_NAME_MAX = 60;
export const SESSION_NAME_MAX = 40;
export const POSITION_MAX = 999;
export const DAYS = 7; // a schedule's days, Monday first

export interface Schedule {
  mode: "rotation" | "fixed";
  days: readonly (string | null)[]; // a session id or null per day
}
export const DEFAULT_SCHEDULE: Schedule = { mode: "rotation", days: Array(DAYS).fill(null) };

export interface Program {
  id: string;
  name: string | null;
  schedule: Schedule;
  removed: boolean;
}

// No stored letter: a session's letter is its place in the active rotation (PM9).
export interface ProgramSession {
  id: string;
  name: string | null;
  programId: string | null; // null: set aside in the collection
  position: number; // within its program, or within the collection
  removed: boolean;
}

export interface ProgramSlot extends Omit<Slot, "rule" | "added" | "skipped"> {
  id: string;
  sessionId: string;
  position: number; // within its section: normal slots, or the no-climbing ones
  rule: "no_climbing" | null;
  removed: boolean;
}

export interface StoredPrograms {
  activeId: string | null; // null, or a removed program: no rotation offered (RD4)
  activeAt: string | null; // when it became active; null: since the start
  programs: readonly Program[];
  sessions: readonly ProgramSession[];
  slots: readonly ProgramSlot[];
}

// The starting program's ids, the same for every account: a version 7 shape with a zero time part,
// so a generated id never collides with one. Sessions A, B, C are 1, 2, 3; session k's slots
// start at k·0x100 + 1, normal ones first, then the no-climbing ones; the program is 0x10. Once
// shipped these ids are frozen forever, like the starting program itself: phones and the server
// match rows by them.
export const seedId = (n: number): string =>
  "00000000-0000-7000-8000-" + n.toString(16).padStart(12, "0");
export const SEED_PROGRAM_ID = seedId(0x10);

function seedOf(templates: readonly SessionTemplate[]): StoredPrograms {
  const sessions: ProgramSession[] = [];
  const slots: ProgramSlot[] = [];
  templates.forEach((t, i) => {
    const sessionId = seedId(i + 1);
    sessions.push({
      id: sessionId,
      name: null,
      programId: SEED_PROGRAM_ID,
      position: i,
      removed: false,
    });
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
  return {
    activeId: SEED_PROGRAM_ID,
    activeAt: null,
    programs: [{ id: SEED_PROGRAM_ID, name: null, schedule: DEFAULT_SCHEDULE, removed: false }],
    sessions,
    slots,
  };
}

// Built from the constant, so the two can never drift apart (SD1).
export const SEED: StoredPrograms = seedOf(starterProgram);

const seedSessions = new Set(SEED.sessions.map((s) => s.id));
export const isSeedSession = (id: string): boolean => seedSessions.has(id);

// Stored rows win by id; every seed row the device lacks is read from SEED (SD3).
function overlay<T extends { id: string }>(seed: readonly T[], stored: readonly T[]): T[] {
  const byId = new Map(stored.map((r) => [r.id, r]));
  const seedIds = new Set(seed.map((r) => r.id));
  return [...seed.map((r) => byId.get(r.id) ?? r), ...stored.filter((r) => !seedIds.has(r.id))];
}

// The active pointer and its time travel together: with no stored pointer, the seed's.
export const withSeed = (stored: Partial<StoredPrograms>): StoredPrograms => ({
  ...(stored.activeId === undefined
    ? { activeId: SEED.activeId, activeAt: SEED.activeAt }
    : { activeId: stored.activeId, activeAt: stored.activeAt ?? null }),
  programs: overlay(SEED.programs, stored.programs ?? []),
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

// A rotation session as the screens start it: its template, lettered by its place (code), with
// the session it comes from.
export interface LetteredTemplate extends SessionTemplate {
  sessionId: string;
  name: string | null;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// The active program's live sessions in order, each with its normal slots, then its no-climbing
// slots as the template's conditional rule (planFor marks them). A session with no live normal slot
// cannot be started, so it is left out and the letters close up (PM6, PM7); letters follow the
// place, A first, up to Z (PM9). No active program, or a removed one, offers none (RD4).
export function rotationOf(p: StoredPrograms): LetteredTemplate[] {
  const active = p.programs.find((x) => x.id === p.activeId && !x.removed);
  if (!active) return [];
  const live = p.slots.filter((s) => !s.removed).sort(byPosition);
  return p.sessions
    .filter((s) => s.programId === active.id && !s.removed)
    .sort(byPosition)
    .flatMap((session) => {
      const own = live.filter((s) => s.sessionId === session.id);
      const slots = own.filter((s) => s.rule === null).map(toSlot);
      if (slots.length === 0) return [];
      const noClimbing = own.filter((s) => s.rule === "no_climbing").map(toSlot);
      return [{ slots, noClimbing, sessionId: session.id, name: session.name }];
    })
    .slice(0, MAX_ROTATION)
    .map(({ noClimbing, ...t }, i) => ({
      code: LETTERS[i]!,
      ...t,
      ...(noClimbing.length > 0 && { noClimbing }),
    }));
}

// The session after the last one finished since the program became active (PM10): found by the
// session it recorded, or by its letter when it recorded none (started before sessions recorded
// theirs); the first when there is none, or when that session left the rotation.
export function nextInRotation(
  workouts: readonly {
    sessionCode: string;
    sessionId?: string | null;
    startedAt: string;
    endedAt: string | null;
    removed: boolean;
  }[],
  rotation: readonly LetteredTemplate[],
  activeAt: string | null,
): LetteredTemplate | null {
  if (rotation.length === 0) return null;
  // Times compared as instants: the pointer's time comes from the server, a start from the phone.
  const since = activeAt === null ? -Infinity : Date.parse(activeAt);
  let last: (typeof workouts)[number] | null = null;
  for (const w of workouts)
    if (w.endedAt !== null && !w.removed && Date.parse(w.startedAt) >= since)
      if (last === null || Date.parse(w.startedAt) > Date.parse(last.startedAt)) last = w;
  const at =
    last === null
      ? -1
      : last.sessionId
        ? rotation.findIndex((t) => t.sessionId === last.sessionId)
        : rotation.findIndex((t) => t.code === last.sessionCode);
  return rotation[(at + 1) % rotation.length]!;
}

// A name: null, or 1 to max characters with no space at either end and no control character
// (Postgres text refuses NUL); counted in UTF-16 units, as notes.
const isName = (v: unknown, max: number): v is string | null =>
  v === null ||
  (typeof v === "string" &&
    v.length >= 1 &&
    v.length <= max &&
    v === v.trim() &&
    !/\p{Cc}/u.test(v));
export const isProgramName = (v: unknown): v is string | null => isName(v, PROGRAM_NAME_MAX);
export const isSessionName = (v: unknown): v is string | null => isName(v, SESSION_NAME_MAX);

export const isPosition = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= POSITION_MAX;

// A day names a session by its id, lower case as ids are written (z.uuid's shape).
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isSchedule = (v: unknown): v is Schedule => {
  const s = v as Record<string, unknown>;
  return (
    typeof s === "object" &&
    s !== null &&
    (s.mode === "rotation" || s.mode === "fixed") &&
    Array.isArray(s.days) &&
    s.days.length === DAYS &&
    s.days.every((d) => d === null || (typeof d === "string" && SESSION_ID.test(d)))
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
