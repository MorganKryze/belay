import type { ISODate } from "../body/dates";
import { isProgramSlot, SLOT_FIELDS } from "../training/stored-program";
import type { ProgramSlotChange, ProgramSlotRow, TargetChange, WeightChange } from "./schema";

// Last write wins, field by field. Strictly later wins: on a tie what is stored stays, so
// replaying a batch that was already applied changes nothing.
export function isNewer(incoming: string, existing: string | null): boolean {
  return existing === null || Date.parse(incoming) > Date.parse(existing);
}

// A phone clock running ahead would otherwise win every later edit made elsewhere.
// ponytail: clamping makes a clock running ahead degrade to "last arrival": a replay after a lost
// response clamps to a later `now` and can overwrite an edit made elsewhere in between. Upgrade
// path: server-issued timestamps on first receipt, or per-device logical clocks.
export function clampAt(at: string, now: Date): string {
  return Date.parse(at) > now.getTime() ? now.toISOString() : at;
}

// Folds one batch, oldest change first, over the stored timestamps. Against what is stored the
// rule is strict; inside the batch a later change wins a tie, because two edits clamped to the
// same `now` still arrive in the order the person made them.
function fold<C extends { at: string }>(stored: string | null, changes: readonly C[], now: Date) {
  let current = stored;
  let winner: C | undefined;
  for (const change of changes) {
    const at = clampAt(change.at, now);
    const wins = winner ? !isNewer(current!, at) : isNewer(at, current);
    if (wins) {
      winner = { ...change, at };
      current = at;
    }
  }
  return winner;
}

// The change to write for each key (a day, a day's field, an id's field), clamped, or nothing
// when what is stored under that key is as recent. A change keeps its other properties (the
// server tags each one with its place in the request).
export function mergeFields<C extends { at: string }>(
  stored: ReadonlyMap<string, string | null>,
  changes: readonly C[],
  key: (change: C) => string,
  now: Date,
): C[] {
  const byKey = new Map<string, C[]>();
  for (const c of changes) byKey.set(key(c), [...(byKey.get(key(c)) ?? []), c]);
  return [...byKey].flatMap(([k, list]) => fold(stored.get(k) ?? null, list, now) ?? []);
}

export function mergeWeights<C extends WeightChange>(
  stored: ReadonlyMap<ISODate, string | null>,
  changes: readonly C[],
  now: Date,
): C[] {
  return mergeFields(stored, changes, (c) => c.date, now);
}

export function mergeTarget<C extends TargetChange>(
  stored: string | null,
  changes: readonly C[],
  now: Date,
): C | null {
  return fold(stored, changes, now) ?? null;
}

// The keys whose stored write is strictly newer than the last change sent for them. The phone
// that sent it shows an older value: it gets the stored row back, whatever its cursor says.
export function staleKeys<C extends { at: string }>(
  stored: ReadonlyMap<string, string | null>,
  changes: readonly C[],
  key: (change: C) => string,
  now: Date,
): Set<string> {
  const latest = new Map<string, string>();
  for (const c of changes) {
    const at = clampAt(c.at, now);
    const seen = latest.get(key(c));
    if (seen === undefined || isNewer(at, seen)) latest.set(key(c), at);
  }
  const stale = new Set<string>();
  for (const [k, at] of latest) {
    const kept = stored.get(k) ?? null;
    if (kept !== null && isNewer(kept, at)) stale.add(k);
  }
  return stale;
}

// One change over a slot's stored row, field by field, at its clamped time (SY2): the row it
// leaves; the same row when what is stored is as recent (a creation is written once); null when it
// is refused, the row going back and the phone reverting. Refused: a rep range or warm-ups written
// for another measure than the row's, which would be read in the wrong unit (ED4), or a merged
// slot out of its bounds (decision 7). The server and the phone both merge with it.
export function mergeSlotChange(
  row: ProgramSlotRow,
  change: ProgramSlotChange,
): ProgramSlotRow | null {
  if (change.field === "create") return row;
  const { at } = change;
  let next: ProgramSlotRow;
  if (change.field === "exercise") {
    if (!isNewer(at, row.exerciseAt)) return row;
    // In another measure the row's range and warm-ups mean nothing: the exercise's replace them,
    // however recent. In the same one they stay as they are: the change carries the sender's
    // unedited values, which would overwrite an edit it never saw.
    next = { ...row, exerciseId: change.exerciseId, measure: change.measure, exerciseAt: at };
    if (change.measure !== row.measure)
      next = {
        ...next,
        repRange: [...change.repRange] as [number, number],
        repsAt: at,
        warmupSets: change.warmupSets,
        warmupsAt: at,
      };
  } else {
    // Built on a view from before a change of measure: refused whatever its time, never dropped
    // as merely stale, so the sender learns its edit did not land.
    if ((change.field === "reps" || change.field === "warmups") && change.measure !== row.measure)
      return null;
    const atKey = `${change.field}At` as const;
    if (!isNewer(at, row[atKey])) return row;
    const key = Object.hasOwn(SLOT_FIELDS, change.field)
      ? SLOT_FIELDS[change.field as keyof typeof SLOT_FIELDS]
      : change.field;
    next = { ...row, [key]: change.value, [atKey]: at };
  }
  // A timed slot takes no warm-up (ED4), whichever change brought it.
  if (next.measure === "seconds" && next.warmupSets > 0) return null;
  return isProgramSlot({ ...next, measure: next.measure ?? undefined }) ? next : null;
}

// One change of a batch over a slot's row, as mergeSlotChange, but a later change wins a tie with
// a time an earlier change of the same batch wrote: two edits at one instant, clamped or made
// together, still arrive in the order they were made. Against what was stored before the batch
// the rule stays strict. `written` gathers the times the batch wrote, by slot; times compare as
// instants, with or without their milliseconds. The same row when nothing changes.
export function mergeSlotInBatch(
  row: ProgramSlotRow,
  change: ProgramSlotChange,
  written: Set<string>,
): ProgramSlotRow | null {
  // A creation's "createAt" is never written, so it merges as mergeSlotChange has it.
  const time = `${change.field}At` as keyof ProgramSlotRow;
  const base =
    written.has(row.id + time) && !isNewer(row[time] as string, change.at)
      ? { ...row, [time]: null }
      : row;
  const next = mergeSlotChange(base, change);
  if (next === base) return row;
  // A row's times are its keys ending in "At"; an exercise in another measure writes three.
  if (next)
    for (const [k, v] of Object.entries(next))
      if (k.endsWith("At") && v !== row[k as keyof ProgramSlotRow]) written.add(row.id + k);
  return next;
}
