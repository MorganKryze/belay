// The editor's rules: each edit of a program, a session or a slot as the sync changes it queues,
// or null when the phone refuses it (ED1 to ED4, PM11). Never imported at startup: only the
// editing screens need it.
import type { Measure } from "../exercises/library";
import type {
  ActiveProgramChange,
  ProgramChange,
  ProgramSessionChange,
  ProgramSlotChange,
} from "../sync/schema";
import { appendSlot, replaceSlot } from "./plan";
import {
  byPosition,
  DEFAULT_SCHEDULE,
  isProgramSlot,
  MAX_PROGRAMS,
  MAX_ROTATION,
  MAX_SESSIONS,
  type ProgramSession,
  type ProgramSlot,
  type Schedule,
  SLOT_FIELDS,
  type SlotField,
  type StoredPrograms,
} from "./stored-program";
import { MAX_SLOTS, type Slot } from "./workout";

type Exercise = { id: string; measure: Measure };
// One value of a slot, as editSlot takes it: the change without its envelope.
type EditOf<C> = C extends { field: SlotField | "rule"; value: unknown }
  ? Pick<C, "field" | "value">
  : never;
export type SlotEdit = EditOf<ProgramSlotChange>;

const live = <T extends { removed: boolean }>(rows: readonly T[]) => rows.filter((r) => !r.removed);
const liveProgram = (p: StoredPrograms, id: string) =>
  p.programs.some((x) => x.id === id && !x.removed);

// A program with no name and the rotation schedule; refused past 20 live programs (PM11).
export function createProgram(p: StoredPrograms, id: string, at: string): ProgramChange[] | null {
  if (live(p.programs).length >= MAX_PROGRAMS) return null;
  return [{ kind: "program", id, field: "create", name: null, schedule: DEFAULT_SCHEDULE, at }];
}

export const renameProgram = (id: string, name: string | null, at: string): ProgramChange[] => [
  { kind: "program", id, field: "name", value: name, at },
];

export const setSchedule = (id: string, schedule: Schedule, at: string): ProgramChange[] => [
  { kind: "program", id, field: "schedule", value: schedule, at },
];

// The active program is never removed: another one is chosen first (ED2).
export const removeProgram = (p: StoredPrograms, id: string, at: string): ProgramChange[] | null =>
  id === p.activeId ? null : [{ kind: "program", id, field: "removed", value: true, at }];

export const chooseActive = (
  p: StoredPrograms,
  programId: string,
  at: string,
): ActiveProgramChange[] | null =>
  liveProgram(p, programId) ? [{ kind: "activeProgram", programId, at }] : null;

// The live sessions of a program's rotation, or of the collection (null), in order.
const siblings = (p: StoredPrograms, programId: string | null, but?: string) =>
  live(p.sessions)
    .filter((s) => s.programId === programId && s.id !== but)
    .sort(byPosition);

// A session with no name at the end of a rotation, or of the collection; refused past 200
// sessions in the account or 26 in the rotation (PM11), or in a program the account lacks.
export function addSession(
  p: StoredPrograms,
  id: string,
  programId: string | null,
  at: string,
): ProgramSessionChange[] | null {
  if (live(p.sessions).length >= MAX_SESSIONS) return null;
  const list = siblings(p, programId);
  if (programId !== null && (!liveProgram(p, programId) || list.length >= MAX_ROTATION))
    return null;
  return [
    {
      kind: "programSession",
      id,
      field: "create",
      name: null,
      programId,
      position: list.length,
      at,
    },
  ];
}

export const renameSession = (
  id: string,
  name: string | null,
  at: string,
): ProgramSessionChange[] => [{ kind: "programSession", id, field: "name", value: name, at }];

export const removeSession = (id: string, at: string): ProgramSessionChange[] => [
  { kind: "programSession", id, field: "removed", value: true, at },
];

// A row put at index toIndex of a list, or last past its end.
const insert = <T>(list: T[], row: T, toIndex: number): T[] => {
  list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, row);
  return list;
};

// A session moved to index toIndex of a rotation or of the collection (null). Positions are
// written 0..n-1 over the live sessions of the list it joins and of the list it leaves, and only
// the sessions whose place changes get a change (decision 5). Refused into a rotation already
// holding 26 (PM11) or a program the account lacks.
export function placeSession(
  p: StoredPrograms,
  sessionId: string,
  programId: string | null,
  toIndex: number,
  at: string,
): ProgramSessionChange[] | null {
  const session = live(p.sessions).find((s) => s.id === sessionId);
  if (!session) return null;
  const target = siblings(p, programId, sessionId);
  const moving = session.programId !== programId;
  if (programId !== null && !liveProgram(p, programId)) return null;
  if (programId !== null && moving && target.length >= MAX_ROTATION) return null;
  const placed = (list: readonly ProgramSession[], to: string | null) =>
    list.flatMap((s, position): ProgramSessionChange[] =>
      s.position === position && s.programId === to
        ? []
        : [{ kind: "programSession", id: s.id, field: "place", programId: to, position, at }],
    );
  return [
    ...placed(insert(target, session, toIndex), programId),
    ...(moving ? placed(siblings(p, session.programId, sessionId), session.programId) : []),
  ];
}

const slotOf = (p: StoredPrograms, id: string) => live(p.slots).find((s) => s.id === id);

// A slot at the end of its section with the default targets of « + Exercice »; refused at 30 live
// slots in the session (ED3) or in a session the account lacks.
export function addSlot(
  p: StoredPrograms,
  id: string,
  sessionId: string,
  exercise: Exercise,
  at: string,
  rule: ProgramSlot["rule"] = null,
): ProgramSlotChange[] | null {
  if (!live(p.sessions).some((s) => s.id === sessionId)) return null;
  const own = live(p.slots).filter((s) => s.sessionId === sessionId);
  if (own.length >= MAX_SLOTS) return null;
  const fresh = appendSlot([], exercise)[0]!;
  delete fresh.added; // a session's mark, never a program's
  const position = own.filter((s) => s.rule === rule).length;
  return [{ kind: "programSlot", id, field: "create", sessionId, position, rule, ...fresh, at }];
}

// One value of a slot; refused when the slot would leave its bounds with it (a counted range past
// 100), or for a slot the account lacks.
export function editSlot(
  p: StoredPrograms,
  id: string,
  edit: SlotEdit,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, id);
  const key = edit.field === "rule" ? "rule" : SLOT_FIELDS[edit.field];
  if (!slot || !isProgramSlot({ ...slot, [key]: edit.value })) return null;
  return [{ kind: "programSlot", id, ...edit, at } as ProgramSlotChange];
}

// Another exercise, as replaceSlot does in a session (ED4): in another measure, its default target
// and, timed, no warm-up, each in its own change with the same time.
export function replaceExercise(
  p: StoredPrograms,
  id: string,
  exercise: Exercise,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, id);
  if (!slot) return null;
  const before: Slot = { ...slot, rule: undefined };
  const after = replaceSlot([before], 0, exercise)[0]!;
  const changes: ProgramSlotChange[] = [
    {
      kind: "programSlot",
      id,
      field: "exercise",
      exerciseId: exercise.id,
      measure: after.measure ?? null,
      at,
    },
  ];
  if (after.repRange !== before.repRange)
    changes.push({ kind: "programSlot", id, field: "reps", value: after.repRange, at });
  if (after.warmupSets !== before.warmupSets)
    changes.push({ kind: "programSlot", id, field: "warmups", value: after.warmupSets, at });
  return changes;
}

// A slot moved to index toIndex of its section; only the slots whose position changes get one.
export function moveSlot(
  p: StoredPrograms,
  id: string,
  toIndex: number,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, id);
  if (!slot) return null;
  const section = live(p.slots)
    .filter((s) => s.sessionId === slot.sessionId && s.rule === slot.rule && s.id !== id)
    .sort(byPosition);
  return insert(section, slot, toIndex).flatMap((s, value): ProgramSlotChange[] =>
    s.position === value ? [] : [{ kind: "programSlot", id: s.id, field: "position", value, at }],
  );
}

export const removeSlot = (id: string, at: string): ProgramSlotChange[] => [
  { kind: "programSlot", id, field: "removed", value: true, at },
];
