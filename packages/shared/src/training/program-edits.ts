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
  POSITION_MAX,
  type Program,
  type ProgramSession,
  type ProgramSlot,
  type Schedule,
  SEED,
  SEED_PROGRAM_ID,
  SLOT_FIELDS,
  type SlotField,
  type StoredPrograms,
} from "./stored-program";
import { MAX_SLOTS } from "./workout";

type Exercise = { id: string; measure: Measure };
// One value of a slot, as editSlot takes it: the change without its envelope.
type EditOf<C> = C extends { field: SlotField | "rule"; value: unknown }
  ? Pick<C, "field" | "value">
  : never;
export type SlotEdit = EditOf<ProgramSlotChange>;
export type Edit = ProgramChange | ActiveProgramChange | ProgramSessionChange | ProgramSlotChange;

const live = <T extends { removed: boolean }>(rows: readonly T[]) => rows.filter((r) => !r.removed);
// The position after the last of a list's rows: removals leave gaps, so its count may tie one.
const after = (rows: readonly { position: number }[]) =>
  rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;
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
// sessions in the account or 26 in the rotation (PM11), in a program the account lacks, or past
// position 999 (a reorder writes the list's positions back to 0..n-1).
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
  const position = after(list);
  if (position > POSITION_MAX) return null;
  return [
    {
      kind: "programSession",
      id,
      field: "create",
      name: null,
      programId,
      position,
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

const ownSlots = (p: StoredPrograms, sessionId: string) =>
  live(p.slots).filter((s) => s.sessionId === sessionId);

// The live slots of one section of a session, in order, the slot `but` left out.
export const sectionOf = (
  p: StoredPrograms,
  sessionId: string,
  rule: ProgramSlot["rule"],
  but?: string,
): ProgramSlot[] =>
  ownSlots(p, sessionId)
    .filter((s) => s.rule === rule && s.id !== but)
    .sort(byPosition);

// Positions from..from+n-1 written over a section's slots, only for those whose position changes.
export const renumber = (list: readonly ProgramSlot[], at: string, from = 0): ProgramSlotChange[] =>
  list.flatMap((s, i): ProgramSlotChange[] =>
    s.position === from + i
      ? []
      : [{ kind: "programSlot", id: s.id, field: "position", value: from + i, at }],
  );

export const groupChange = (id: string, value: string | null, at: string): ProgramSlotChange => ({
  kind: "programSlot",
  id,
  field: "group",
  value,
  at,
});

// A group is two rows or more: the one row a group is left with loses the key.
export function dissolved(
  section: readonly ProgramSlot[],
  key: string | null,
  at: string,
): ProgramSlotChange[] {
  const left = section.filter((s) => key !== null && s.groupKey === key);
  return left.length === 1 ? [groupChange(left[0]!.id, null, at)] : [];
}

// A slot at the end of its section with the default targets of « + Exercice », or the values of
// the slot `like` (the row above, as a setting chooses): its sets, RIR, rest and warm-ups (none for
// a timed exercise) and, in the same measure, its range; never its main mark nor its group. Refused
// at 30 live slots in the session (ED3), in a session the account lacks, or past position 999.
export function addSlot(
  p: StoredPrograms,
  id: string,
  sessionId: string,
  exercise: Exercise,
  at: string,
  rule: ProgramSlot["rule"] = null,
  like?: ProgramSlot,
): ProgramSlotChange[] | null {
  if (!live(p.sessions).some((s) => s.id === sessionId)) return null;
  const own = ownSlots(p, sessionId);
  if (own.length >= MAX_SLOTS) return null;
  const fresh = appendSlot([], exercise)[0]!;
  delete fresh.added; // a session's mark, never a program's
  const position = after(own.filter((s) => s.rule === rule));
  if (position > POSITION_MAX) return null;
  const values = like && {
    sets: like.sets,
    rirTarget: like.rirTarget,
    restSec: like.restSec,
    warmupSets: exercise.measure === "seconds" ? 0 : like.warmupSets,
    ...((like.measure ?? "reps") === exercise.measure && { repRange: like.repRange }),
  };
  return [
    {
      kind: "programSlot",
      id,
      field: "create",
      sessionId,
      position,
      rule,
      ...fresh,
      ...values,
      at,
    },
  ];
}

// A slot's creation with every value of `s`, in a session, at a position, in a group.
const createOf = (
  s: ProgramSlot,
  id: string,
  sessionId: string,
  position: number,
  groupKey: string | null,
  at: string,
): ProgramSlotChange => ({
  kind: "programSlot",
  id,
  field: "create",
  sessionId,
  position,
  rule: s.rule,
  exerciseId: s.exerciseId,
  ...(s.measure === "seconds" && { measure: "seconds" as const }),
  sets: s.sets,
  repRange: s.repRange,
  rirTarget: s.rirTarget,
  restSec: s.restSec,
  warmupSets: s.warmupSets,
  isMain: s.isMain,
  groupKey,
  at,
});

// A slot copied right below its source, with every value, in its group so the group stays in one
// piece; the slots after it move down. Refused at 30 live slots in the session.
export function copySlot(
  p: StoredPrograms,
  id: string,
  sourceId: string,
  at: string,
): ProgramSlotChange[] | null {
  const source = slotOf(p, sourceId);
  if (!source || ownSlots(p, source.sessionId).length >= MAX_SLOTS) return null;
  const section = sectionOf(p, source.sessionId, source.rule);
  const below = section.findIndex((s) => s.id === sourceId) + 1;
  return [
    ...renumber(section.slice(0, below), at),
    createOf(source, id, source.sessionId, below, source.groupKey, at),
    ...renumber(section.slice(below), at, below + 1),
  ];
}

const RULES = [null, "no_climbing"] as const;
// A key made from a row's id, as a new group takes its first row's: unique within any session.
const keyOf = (id: string) => id.replace(/-/g, "").slice(-12);

// The live slots of session `sourceId` (in `from`) created after the slots of session `targetId`
// (in `p`), section by section, with new ids; `regroup` gives each copy its group key. Null when the
// target would pass 30 slots or position 999.
function copiesOf(
  from: StoredPrograms,
  sourceId: string,
  p: StoredPrograms,
  targetId: string,
  newId: () => string,
  at: string,
  regroup: (key: string | null, id: string) => string | null = (key) => key,
): ProgramSlotChange[] | null {
  if (ownSlots(p, targetId).length + ownSlots(from, sourceId).length > MAX_SLOTS) return null;
  const copies = RULES.flatMap((rule) => {
    const start = after(sectionOf(p, targetId, rule));
    return sectionOf(from, sourceId, rule).map((s, i) => {
      const id = newId();
      return createOf(s, id, targetId, start + i, regroup(s.groupKey, id), at);
    });
  });
  return copies.some((c) => "position" in c && c.position > POSITION_MAX) ? null : copies;
}

// A session copied last into its source's list (its rotation, or the collection) with every live
// slot, all with new ids. The copy is a new session, so its groups keep their keys.
// Refused past 200 sessions, 26 in the rotation or 30 slots.
export function copySession(
  p: StoredPrograms,
  sourceId: string,
  name: string | null,
  newId: () => string,
  at: string,
): (ProgramSessionChange | ProgramSlotChange)[] | null {
  const source = live(p.sessions).find((s) => s.id === sourceId);
  if (!source) return null;
  const id = newId();
  const created = addSession(p, id, source.programId, at);
  const slots = created && copiesOf(p, sourceId, p, id, newId, at);
  return created && slots && [{ ...created[0]!, name } as ProgramSessionChange, ...slots];
}

// The live slots of a session appended to another one, sections and groups kept; each copied group
// takes a key made from its first row's new id, so it never merges with a group of the target.
// Refused past 30 slots.
export function copySlotsInto(
  p: StoredPrograms,
  targetId: string,
  sourceId: string,
  newId: () => string,
  at: string,
): ProgramSlotChange[] | null {
  if (!live(p.sessions).some((s) => s.id === targetId)) return null;
  const keys = new Map<string, string>();
  return copiesOf(p, sourceId, p, targetId, newId, at, (key, id) => {
    if (key === null) return null;
    if (!keys.has(key)) keys.set(key, keyOf(id));
    return keys.get(key)!;
  });
}

// One value of a slot; refused when the slot would leave its bounds with it (a counted range past
// 100), or for a slot the account lacks. A rep range or warm-ups carry the slot's measure (ED4).
export function editSlot(
  p: StoredPrograms,
  id: string,
  edit: SlotEdit,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, id);
  const key = edit.field === "rule" ? "rule" : SLOT_FIELDS[edit.field];
  if (!slot || !isProgramSlot({ ...slot, [key]: edit.value })) return null;
  const measure =
    edit.field === "reps" || edit.field === "warmups" ? { measure: slot.measure ?? null } : {};
  return [{ kind: "programSlot", id, ...edit, ...measure, at } as ProgramSlotChange];
}

// Another exercise, as replaceSlot does in a session (ED4): in another measure, its default target
// and, timed, no warm-up. One change carries the four, so no merge splits them.
export function replaceExercise(
  p: StoredPrograms,
  id: string,
  exercise: Exercise,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, id);
  if (!slot) return null;
  const next = replaceSlot([{ ...slot, rule: undefined }], 0, exercise)[0]!;
  return [
    {
      kind: "programSlot",
      id,
      field: "exercise",
      exerciseId: exercise.id,
      measure: next.measure ?? null,
      repRange: next.repRange,
      warmupSets: next.warmupSets,
      at,
    },
  ];
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
  return renumber(insert(sectionOf(p, slot.sessionId, slot.rule, id), slot, toIndex), at);
}

export const removeSlot = (id: string, at: string): ProgramSlotChange[] => [
  { kind: "programSlot", id, field: "removed", value: true, at },
];

export type ProgramStart = { kind: "empty" } | { kind: "starter" } | { kind: "copy"; from: string };

// A named program, then its sessions and their slots with new ids, then the pointer that
// makes it active. Empty: one session with no slot. Starter: the shipped starting sessions,
// never the account's edits of them. Copy: the live sessions and slots of program `from`. Refused
// past 20 programs, 200 sessions, 26 in its rotation or 30 slots in a session.
export function newProgram(
  p: StoredPrograms,
  start: ProgramStart,
  name: string,
  newId: () => string,
  at: string,
): Edit[] | null {
  if (start.kind === "copy" && !liveProgram(p, start.from)) return null;
  const from = start.kind === "starter" ? SEED : p;
  const sources =
    start.kind === "empty"
      ? []
      : siblings(from, start.kind === "copy" ? start.from : SEED_PROGRAM_ID);
  const count = Math.max(1, sources.length);
  if (live(p.sessions).length + count > MAX_SESSIONS || count > MAX_ROTATION) return null;
  if (live(p.programs).length >= MAX_PROGRAMS) return null;
  const programId = newId();
  const sessions: ProgramSessionChange[] = [];
  const slots: ProgramSlotChange[] = [];
  for (const [position, source] of (sources.length > 0 ? sources : [null]).entries()) {
    const id = newId();
    sessions.push({
      kind: "programSession",
      id,
      field: "create",
      name: source?.name ?? null,
      programId,
      position,
      at,
    });
    const copies = source ? copiesOf(from, source.id, p, id, newId, at) : [];
    if (!copies) return null;
    slots.push(...copies);
  }
  return [
    { kind: "program", id: programId, field: "create", name, schedule: DEFAULT_SCHEDULE, at },
    ...sessions,
    ...slots,
    { kind: "activeProgram", programId, at },
  ];
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// The live programs in creation order: ids are version 7 UUIDs, which sort by their time, and the
// starting program's zero-time id comes first.
export const programOrder = (p: StoredPrograms): Program[] => live(p.programs).sort(byId);

// The program listed before this one, else the one after it, else none.
export function neighbourOf(p: StoredPrograms, id: string): string | null {
  const order = programOrder(p);
  const i = order.findIndex((x) => x.id === id);
  if (i < 0) return null;
  return (order[i - 1] ?? order[i + 1])?.id ?? null;
}

// A program removed with its sessions: the active one hands the pointer to its
// neighbour first, as the server writes a batch's removals after its active choice and the phone
// applies changes in order. The last live program is never removed.
export function removeProgramFor(p: StoredPrograms, id: string, at: string): Edit[] | null {
  const next = neighbourOf(p, id);
  if (next === null) return null;
  return [
    ...(id === p.activeId ? [{ kind: "activeProgram" as const, programId: next, at }] : []),
    { kind: "program", id, field: "removed", value: true, at },
    ...siblings(p, id).flatMap((s) => removeSession(s.id, at)),
  ];
}

// Whether a live session may leave its list: a rotation keeps at least one session, the
// collection may empty.
const mayLeave = (p: StoredPrograms, id: string) => {
  const session = live(p.sessions).find((s) => s.id === id);
  return (
    session !== undefined &&
    (session.programId === null || siblings(p, session.programId, id).length > 0)
  );
};

export const removeSessionIn = (
  p: StoredPrograms,
  id: string,
  at: string,
): ProgramSessionChange[] | null => (mayLeave(p, id) ? removeSession(id, at) : null);

const programOf = (p: StoredPrograms, id: string) =>
  live(p.sessions).find((s) => s.id === id)?.programId;

// A rotation session moved last into the collection; refused for the last of its rotation.
export const setAside = (
  p: StoredPrograms,
  id: string,
  at: string,
): ProgramSessionChange[] | null =>
  mayLeave(p, id) && programOf(p, id) !== null ? placeSession(p, id, null, Infinity, at) : null;

// A set-aside session moved last into the active rotation; none without an active program.
export const putBack = (
  p: StoredPrograms,
  id: string,
  at: string,
): ProgramSessionChange[] | null =>
  programOf(p, id) === null && p.activeId !== null && liveProgram(p, p.activeId)
    ? placeSession(p, id, p.activeId, Infinity, at)
    : null;

// A row and the next one of its section share one key: this row's, else the next row's,
// else a new one made from this row's id; the next row's whole group follows when both had one.
// None without a next row; nothing to write when they are already chained.
export function chainWithNext(
  p: StoredPrograms,
  slotId: string,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, slotId);
  if (!slot) return null;
  const section = sectionOf(p, slot.sessionId, slot.rule);
  const next = section[section.findIndex((s) => s.id === slotId) + 1];
  if (!next) return null;
  const key = slot.groupKey ?? next.groupKey ?? keyOf(slotId);
  const joining =
    next.groupKey === null ? [next] : section.filter((s) => s.groupKey === next.groupKey);
  return [slot, ...joining].flatMap((s) =>
    s.groupKey === key ? [] : [groupChange(s.id, key, at)],
  );
}

// A row taken out of its group: a middle row moves just below the group so the group stays in
// one piece, and a group left with one row is no group. None for a row in no group.
export function leaveGroup(
  p: StoredPrograms,
  slotId: string,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, slotId);
  if (!slot || slot.groupKey === null) return null;
  const others = sectionOf(p, slot.sessionId, slot.rule, slotId);
  const members = sectionOf(p, slot.sessionId, slot.rule).filter(
    (s) => s.groupKey === slot.groupKey,
  );
  const last = members.at(-1)!;
  const middle = members[0]!.id !== slotId && last.id !== slotId;
  return [
    groupChange(slotId, null, at),
    ...dissolved(others, slot.groupKey, at),
    ...(middle ? renumber(insert(others, slot, others.indexOf(last) + 1), at) : []),
  ];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// The letters an edit changes, given the rotation's session ids before and after it, in the after
// order; a session only in one of the two has no letter change to say.
export const letterMoves = (
  before: readonly string[],
  after: readonly string[],
): { id: string; from: string; to: string }[] =>
  after.flatMap((id, i) => {
    const was = before.indexOf(id);
    return was < 0 || was === i ? [] : [{ id, from: LETTERS.charAt(was), to: LETTERS.charAt(i) }];
  });
