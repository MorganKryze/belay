// Undoing an edit of the programs: new changes that put back the values the edit replaced, only
// where the device still holds what the edit wrote, so a later change from another device stays.
// Never imported at startup: only the editor needs it.
import type {
  ActiveProgramChange,
  ProgramChange,
  ProgramSessionChange,
  ProgramSlotChange,
} from "../sync/schema";
import { SLOT_FIELDS, type ProgramSlot, type StoredPrograms } from "./stored-program";

export type ProgramEdit =
  ProgramChange | ActiveProgramChange | ProgramSessionChange | ProgramSlotChange;

// Values compared by content: ranges and schedules are arrays and objects.
const same = (a: unknown, b: unknown): boolean =>
  a === b ||
  (typeof a === "object" &&
    a !== null &&
    typeof b === "object" &&
    b !== null &&
    Object.keys(a).length === Object.keys(b).length &&
    Object.entries(a).every(([k, v]) => same(v, (b as Record<string, unknown>)[k])));

const rowOf = (p: StoredPrograms, change: Exclude<ProgramEdit, ActiveProgramChange>) =>
  (change.kind === "program"
    ? p.programs
    : change.kind === "programSession"
      ? p.sessions
      : p.slots
  ).find((r: { id: string }) => r.id === change.id);
// The stored rows leave a slot counted in repetitions without a measure; a change writes null.
const measureOf = (slot: ProgramSlot) => slot.measure ?? null;
// The slot value each one-value change writes.
const SLOT_KEYS = {
  ...SLOT_FIELDS,
  rule: "rule",
  position: "position",
  removed: "removed",
} as const;

// The edit's changes walked from the last, each undone on its own; an active-pointer change comes
// first, so the program it points back to is active before anything else lands.
export function undoOf(
  before: StoredPrograms,
  edit: readonly ProgramEdit[],
  now: StoredPrograms,
  clock: string,
): ProgramEdit[] {
  // Strictly after the edit, even on a clock behind it (set back, or another tab's edit read
  // fresh): on a tie or an older time, last write wins would keep the edit.
  const latest = Math.max(...edit.map((c) => Date.parse(c.at)));
  const at = Date.parse(clock) > latest ? clock : new Date(latest + 1).toISOString();
  const undo: ProgramEdit[] = [];
  let pointer: ActiveProgramChange | null = null;
  let pointed = false;
  for (const change of [...edit].reverse()) {
    if (change.kind === "activeProgram") {
      const back = before.activeId;
      if (!pointed && now.activeId === change.programId && back !== null && back !== now.activeId)
        pointer = { kind: "activeProgram", programId: back, at };
      pointed = true;
      continue;
    }
    const was = rowOf(before, change);
    const is = rowOf(now, change);
    if (!is) continue;
    // A creation undoes as a removal flag, while the row is still live.
    if (change.field === "create") {
      if (!is.removed)
        undo.push({ kind: change.kind, id: change.id, field: "removed", value: true, at });
      continue;
    }
    if (!was) continue;
    const back = undoField(change, was, is, at);
    if (back) undo.push(back);
  }
  if (pointer && points(now, undo, pointer.programId)) undo.unshift(pointer);
  return undo;
}

// The program the pointer goes back to is live once the undo lands: live now, or put back by it.
const points = (now: StoredPrograms, undo: readonly ProgramEdit[], programId: string) =>
  now.programs.some((p) => p.id === programId && !p.removed) ||
  undo.some((c) => c.kind === "program" && c.id === programId && c.field === "removed" && !c.value);

// One change other than a creation or the pointer: the previous value, or null when the value
// changed since (another device wrote it) or cannot be read back in the slot's measure.
function undoField(
  change: Exclude<ProgramEdit, ActiveProgramChange | { field: "create" }>,
  was: object,
  is: object,
  at: string,
): ProgramEdit | null {
  const then = was as Record<string, unknown>;
  const held = is as Record<string, unknown>;
  switch (change.kind) {
    case "program":
    case "programSession":
      if (change.field === "place") {
        const placeNow = { programId: held.programId, position: held.position };
        if (!same(placeNow, { programId: change.programId, position: change.position }))
          return null;
        return {
          kind: "programSession",
          id: change.id,
          field: "place",
          programId: then.programId as string | null,
          position: then.position as number,
          at,
        };
      }
      if (!same(held[change.field], change.value)) return null;
      return { ...change, value: then[change.field], at } as ProgramEdit;
    case "programSlot": {
      const slotNow = is as ProgramSlot;
      const slotThen = was as ProgramSlot;
      if (change.field === "exercise") {
        if (slotNow.exerciseId !== change.exerciseId || measureOf(slotNow) !== change.measure)
          return null;
        return {
          kind: "programSlot",
          id: change.id,
          field: "exercise",
          exerciseId: slotThen.exerciseId,
          measure: measureOf(slotThen),
          repRange: slotThen.repRange,
          warmupSets: slotThen.warmupSets,
          at,
        };
      }
      const key = SLOT_KEYS[change.field];
      if (!same(held[key], change.value)) return null;
      if (change.field === "reps" || change.field === "warmups") {
        // A range or warm-ups mean nothing in another measure: skipped when the slot changed
        // measure since, or when the previous value was written for another one.
        const measure = measureOf(slotNow);
        if (measure !== change.measure || measureOf(slotThen) !== measure) return null;
        return { ...change, value: then[key], measure, at } as ProgramEdit;
      }
      return { ...change, value: then[key], at } as ProgramEdit;
    }
  }
}
