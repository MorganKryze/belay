// Where a lifted row may land in its session, and what landing there writes: a stop is a
// section, a place in it, and the group the row takes there. Crossing a group's edge or the
// no-climbing section's border changes what the row belongs to. Never imported at startup: only
// the editor needs it.
import type { ProgramSlotChange } from "../sync/schema";
import { dissolved, groupChange, keptApart, renumber, runOf, sectionOf } from "./program-edits";
import type { ProgramSlot, StoredPrograms } from "./stored-program";

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
// inside the group below; a single stop inside when both neighbours are one group (a group is its
// consecutive rows, the lifted row still in place), so a first step at a group's edge lands just
// outside and the next one inside. Two groups of one key on both sides offer only the outside stop:
// that key there would merge them. An empty section offers one stop.
export function slotStops(p: StoredPrograms, slotId: string): Stop[] {
  const slot = slotOf(p, slotId);
  if (!slot) return [];
  return RULES.flatMap((rule) => {
    const all = sectionOf(p, slot.sessionId, rule);
    const rows = all.filter((s) => s.id !== slotId);
    return Array.from({ length: rows.length + 1 }, (_, index): Stop[] => {
      const above = rows[index - 1]?.groupKey ?? null;
      const below = rows[index]?.groupKey ?? null;
      const oneGroup = above !== null && runOf(all, rows[index - 1]!.id).includes(rows[index]!);
      if (oneGroup) return [{ rule, index, groupKey: above }];
      if (above !== null && above === below) return [{ rule, index, groupKey: null }];
      return [above, null, below].flatMap((groupKey, i) =>
        groupKey === null && i !== 1 ? [] : [{ rule, index, groupKey }],
      );
    }).flat();
  });
}

// The stop the row sits at now: its section, its place and its group; a row alone with its key sits
// outside at its place. -1 for a row the account lacks.
export function stopOf(p: StoredPrograms, slotId: string): number {
  const slot = slotOf(p, slotId);
  if (!slot) return -1;
  const index = sectionOf(p, slot.sessionId, slot.rule).findIndex((s) => s.id === slotId);
  const stops = slotStops(p, slotId);
  const here = { rule: slot.rule, index, groupKey: slot.groupKey };
  const exact = stops.findIndex((s) => same(s, here));
  return exact >= 0 ? exact : stops.findIndex((s) => same(s, { ...here, groupKey: null }));
}

// What landing at a stop does to the row's group, read as runs of consecutive rows: a row alone with
// its key is in no group. It leaves its group unless the stop is inside that same run, and joins the
// stop's group unless it was already in it. Its key is written when the group it lands in differs,
// or when a key it keeps would join it to a neighbour.
function groupMove(p: StoredPrograms, slot: ProgramSlot, stop: Stop, into: readonly ProgramSlot[]) {
  const mine = runOf(sectionOf(p, slot.sessionId, slot.rule), slot.id);
  const grouped = mine.length > 1;
  const near = [into[stop.index - 1], into[stop.index + 1]].filter((s) => s !== undefined);
  const stays =
    grouped &&
    stop.rule === slot.rule &&
    stop.groupKey === slot.groupKey &&
    near.some((s) => s.groupKey === slot.groupKey && mine.some((m) => m.id === s.id));
  const leaves = grouped && !stays;
  const joins = stop.groupKey !== null && !stays;
  const writes =
    stop.groupKey !== null
      ? slot.groupKey !== stop.groupKey
      : slot.groupKey !== null && (leaves || near.some((s) => s.groupKey === slot.groupKey));
  return { leaves, joins, writes };
}

const landing = (p: StoredPrograms, slot: ProgramSlot, stop: Stop) => {
  const into = sectionOf(p, slot.sessionId, stop.rule, slot.id);
  into.splice(stop.index, 0, slot);
  return into;
};

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
  const into = landing(p, slot, stop);
  const left = sectionOf(p, slot.sessionId, slot.rule, slotId);
  const { leaves, writes } = groupMove(p, slot, stop, into);
  // A row that kept two runs of one key apart and joins the lower one leaves the key to it.
  const from = sectionOf(p, slot.sessionId, slot.rule);
  const at0 = from.findIndex((s) => s.id === slotId);
  const joinsLower =
    stop.rule === slot.rule && stop.groupKey === from[at0 + 1]?.groupKey && stop.index > at0;
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
    ...(writes ? [groupChange(slotId, stop.groupKey, at)] : []),
    ...renumber(into, at),
    ...(slot.rule === stop.rule ? [] : renumber(left, at)),
    ...(leaves ? dissolved(from, slotId, at) : []),
    ...(stop.rule === slot.rule && stop.index === at0
      ? []
      : keptApart(from, slotId, at, joinsLower)),
  ];
}

export type MoveNote = "joinGroup" | "leaveGroup" | "toNoClimbing" | "toPermanent";

// What a move changes, to be said in words: the group left, the group joined, the section.
export function moveNotes(p: StoredPrograms, slotId: string, stop: Stop): MoveNote[] {
  const slot = slotOf(p, slotId);
  if (!slot) return [];
  const { leaves, joins } = groupMove(p, slot, stop, landing(p, slot, stop));
  const notes: MoveNote[] = [];
  if (leaves) notes.push("leaveGroup");
  if (joins) notes.push("joinGroup");
  if (slot.rule !== stop.rule) notes.push(stop.rule === null ? "toPermanent" : "toNoClimbing");
  return notes;
}
