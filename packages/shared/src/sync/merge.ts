import type { ISODate } from "../body/dates";
import type { TargetChange, WeightChange } from "./schema";

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
