// Where a lifted row may land in its session, and what landing there writes: a stop is a
// section, a place in it, and the group the row takes there. Crossing a group's edge or the
// no-climbing section's border changes what the row belongs to. Never imported at startup: only
// the editor needs it.
import type { ProgramSlotChange } from "../sync/schema";
import { dissolved, groupChange, renumber, sectionOf } from "./program-edits";
import type { StoredPrograms } from "./stored-program";

export interface Stop {
  rule: "no_climbing" | null;
  index: number; // among the section's rows, the lifted row left out
  groupKey: string | null;
}

const RULES = [null, "no_climbing"] as const;
const slotOf = (p: StoredPrograms, id: string) => p.slots.find((s) => s.id === id && !s.removed);
const same = (a: Stop, b: Stop) =>
  a.rule === b.rule && a.index === b.index && a.groupKey === b.groupKey;

// For each gap of the normal section, then of the no-climbing one: inside the group above, outside,
// inside the group below; a single stop inside when both neighbours share a group, so a first step
// at a group's edge lands just outside and the next one inside. An empty section offers one stop.
export function slotStops(p: StoredPrograms, slotId: string): Stop[] {
  const slot = slotOf(p, slotId);
  if (!slot) return [];
  return RULES.flatMap((rule) => {
    const rows = sectionOf(p, slot.sessionId, rule, slotId);
    return Array.from({ length: rows.length + 1 }, (_, index): Stop[] => {
      const above = rows[index - 1]?.groupKey ?? null;
      const below = rows[index]?.groupKey ?? null;
      if (above !== null && above === below) return [{ rule, index, groupKey: above }];
      return [above, null, below].flatMap((groupKey, i) =>
        groupKey === null && i !== 1 ? [] : [{ rule, index, groupKey }],
      );
    }).flat();
  });
}

// The stop the row sits at now: its section, its place and its group; a row whose group has no
// neighbour of the same key sits at its place's first stop. -1 for a row the account lacks.
export function stopOf(p: StoredPrograms, slotId: string): number {
  const slot = slotOf(p, slotId);
  if (!slot) return -1;
  const index = sectionOf(p, slot.sessionId, slot.rule).findIndex((s) => s.id === slotId);
  const stops = slotStops(p, slotId);
  const here = { rule: slot.rule, index, groupKey: slot.groupKey };
  const exact = stops.findIndex((s) => same(s, here));
  return exact >= 0 ? exact : stops.findIndex((s) => s.rule === slot.rule && s.index === index);
}

// The row at a stop it is offered: its rule and its group key when they change, positions 0..n-1
// over each section it touches for the rows whose position changes, and no key for the one row a
// group it left keeps. Null for a stop not offered or a row the account lacks.
export function placeSlot(
  p: StoredPrograms,
  slotId: string,
  stop: Stop,
  at: string,
): ProgramSlotChange[] | null {
  const slot = slotOf(p, slotId);
  if (!slot || !slotStops(p, slotId).some((s) => same(s, stop))) return null;
  const into = sectionOf(p, slot.sessionId, stop.rule, slotId);
  into.splice(stop.index, 0, slot);
  const left = sectionOf(p, slot.sessionId, slot.rule, slotId);
  const keyChanges = slot.groupKey !== stop.groupKey;
  return [
    ...(slot.rule === stop.rule
      ? []
      : [
          {
            kind: "programSlot" as const,
            id: slotId,
            field: "rule" as const,
            value: stop.rule,
            at,
          },
        ]),
    ...(keyChanges ? [groupChange(slotId, stop.groupKey, at)] : []),
    ...renumber(into, at),
    ...(slot.rule === stop.rule ? [] : renumber(left, at)),
    ...(keyChanges ? dissolved(left, slot.groupKey, at) : []),
  ];
}

export type MoveNote = "joinGroup" | "leaveGroup" | "toNoClimbing" | "toPermanent";

// What a move changes, to be said in words: the group left, the group joined, the section.
export function moveNotes(p: StoredPrograms, slotId: string, stop: Stop): MoveNote[] {
  const slot = slotOf(p, slotId);
  if (!slot) return [];
  const keyChanges = slot.groupKey !== stop.groupKey;
  const notes: MoveNote[] = [];
  if (keyChanges && slot.groupKey !== null) notes.push("leaveGroup");
  if (keyChanges && stop.groupKey !== null) notes.push("joinGroup");
  if (slot.rule !== stop.rule) notes.push(stop.rule === null ? "toPermanent" : "toNoClimbing");
  return notes;
}
