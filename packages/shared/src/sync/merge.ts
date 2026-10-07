import type { ISODate } from "../body/dates";
import type { TargetChange, WeightChange } from "./schema";

// Last write wins, field by field. Strictly later wins: on a tie what is stored stays, so
// replaying a batch that was already applied changes nothing.
export function isNewer(incoming: string, existing: string | null): boolean {
  return existing === null || Date.parse(incoming) > Date.parse(existing);
}

// A phone clock running ahead would otherwise win every later edit made elsewhere.
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

// The change to write for each day, clamped, or nothing when what is stored is as recent.
export function mergeWeights(
  stored: ReadonlyMap<ISODate, string | null>,
  changes: readonly WeightChange[],
  now: Date,
): WeightChange[] {
  const byDate = new Map<ISODate, WeightChange[]>();
  for (const c of changes) byDate.set(c.date, [...(byDate.get(c.date) ?? []), c]);
  return [...byDate].flatMap(([date, list]) => fold(stored.get(date) ?? null, list, now) ?? []);
}

export function mergeTarget(
  stored: string | null,
  changes: readonly TargetChange[],
  now: Date,
): TargetChange | null {
  return fold(stored, changes, now) ?? null;
}
