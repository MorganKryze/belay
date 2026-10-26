// Which sessions and weigh-ins Health should hold, from the phone's own data: Belay's rules for
// Apple Health, kept here so the native side only carries them out. No clock, no storage.
import { toISODate } from "@belay/shared/body/dates";
import type { SetRow, WeightRow, WorkoutRow } from "@belay/shared/sync/schema";
import type { HealthObject, HealthOutcome, HealthSettings, Written } from "./health";

export const sessionKey = (id: string): string => `belay-session-${id}`;
export const weighingKey = (date: string): string => `belay-weighing-${date}`;
// Health keeps one store for every app on the phone, and a weigh-in's sync identifier is its day:
// two accounts (or one account on two instances) with Health on would replace and delete each
// other's samples. The identifier also carries this tag of the account database's name, which
// names both. FNV-1a on 32 bits: a clash between the few accounts of one phone is a one in four
// billion chance, and the tag stays the same across launches.
export function ownerOf(name: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
// The record is the account database's own, so its keys need no owner.
export const keyOf = (o: HealthObject): string =>
  o.kind === "workout" || o.kind === "workoutRemoved" ? sessionKey(o.id) : weighingKey(o.date);

export type HealthPlanInput = {
  workouts: readonly WorkoutRow[];
  sets: readonly SetRow[];
  weights: readonly WeightRow[]; // a null weight is a deleted day
  settings: HealthSettings;
  written: Readonly<Record<string, Written>>;
  filled: Readonly<Record<string, unknown>>; // the days the import wrote
  allowed: { workouts: boolean; weighings: boolean };
  now: number;
  owner: string; // ownerOf the account database's name
};

const ms = (iso: string | null) => (iso === null ? -Infinity : Date.parse(iso));

// A session Health can hold: ended, still there, at least one set still there, and ending after
// it starts (a workout needs a span). Null for one in progress, removed or empty.
export function finishedSpan(
  w: WorkoutRow,
  liveSets: number,
): { startedAt: number; endedAt: number } | null {
  if (w.endedAt === null || w.removed || liveSets === 0) return null;
  const startedAt = Date.parse(w.startedAt);
  const endedAt = Date.parse(w.endedAt);
  return endedAt > startedAt ? { startedAt, endedAt } : null;
}

// What the native side takes, as it checks it: a batch with one object outside these bounds is
// refused whole, so such an object is never sent. Times from 1899-12-31 in UTC (08:00 on
// 1900-01-01, the earliest day Belay keeps, east of UTC) to a day past the phone's clock, a
// workout of a day at most, a weigh-in of 20 to 400 kg.
const EARLIEST = Date.UTC(1899, 11, 31);
const DAY = 86_400_000;
const isTime = (t: number, now: number) => t >= EARLIEST && t <= now + DAY;
const healthTakesSpan = (s: { startedAt: number; endedAt: number }, now: number) =>
  isTime(s.startedAt, now) && isTime(s.endedAt, now) && s.endedAt - s.startedAt <= DAY;
const healthTakesKg = (kg: number) => kg >= 20 && kg <= 400;

// Always above the last version this phone wrote, even with a clock set back; otherwise the
// latest time written on the row, which every device derives alike from the merged data.
export const versionOf = (latest: number, last: number | undefined): number =>
  Math.max(Math.floor(latest), (last ?? 0) + 1);

// A weigh-in has a day and no time: 08:00 local on that day, or now when that is earlier, so no
// sample is ever in the future.
export function sampleTime(date: string, now: number): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.min(new Date(y, m - 1, d, 8).getTime(), now);
}

// What Health is asked to do, in the order the rows come: every write and removal that would
// bring it in line with the phone's data, the types it refuses left out.
export function planHealth(input: HealthPlanInput): HealthObject[] {
  const { settings, written, filled, allowed, owner } = input;
  if (!settings.on) return [];
  const everything = settings.history !== "no";
  const from = settings.turnedOnAt ?? Infinity;
  const fromDay = settings.turnedOnAt === null ? "9999-12-31" : toISODate(new Date(from));
  const objects: HealthObject[] = [];

  if (allowed.workouts) {
    const live = new Map<string, number>();
    for (const s of input.sets)
      if (!s.removed) live.set(s.workoutId, (live.get(s.workoutId) ?? 0) + 1);
    for (const w of input.workouts) {
      const key = sessionKey(w.id);
      const kept = written[key];
      const finished = finishedSpan(w, live.get(w.id) ?? 0);
      // One Health would refuse is no session for it: left out, or removed if it was written.
      const span = finished && healthTakesSpan(finished, input.now) ? finished : null;
      if (span) {
        // Eligible: new since the setting went on, everything after the history action, and
        // always what this phone already wrote, so its edits follow.
        if (!everything && span.endedAt < from && !kept) continue;
        if (
          (kept?.state === "workout" || kept?.state === "skipped") &&
          kept.startedAt === span.startedAt &&
          kept.endedAt === span.endedAt
        )
          continue;
        const latest = Math.max(
          ...[w.startedAt, w.startedAtAt, w.endedAt, w.endedAtAt, w.removedAt].map(ms),
        );
        objects.push({
          kind: "workout",
          id: w.id,
          ...span,
          version: versionOf(latest, kept?.version),
        });
      } else if (kept?.state === "workout") {
        objects.push({ kind: "workoutRemoved", id: w.id });
      }
    }
  }

  if (allowed.weighings) {
    for (const r of input.weights) {
      // A day the import filled is already in Health, as the scale's reading.
      if (r.date in filled) continue;
      const key = weighingKey(r.date);
      const kept = written[key];
      const at = sampleTime(r.date, input.now);
      if (r.weightKg !== null && healthTakesKg(r.weightKg) && isTime(at, input.now)) {
        if (!everything && r.date < fromDay && !kept) continue;
        if (kept?.state === "weighing" && kept.kg === r.weightKg) continue;
        objects.push({
          kind: "weighing",
          owner,
          date: r.date,
          kg: r.weightKg,
          at,
          version: versionOf(Date.parse(r.at), kept?.version),
        });
      } else if (kept?.state === "weighing") {
        objects.push({ kind: "weighingRemoved", owner, date: r.date });
      }
    }
  }
  return objects;
}

// What the record keeps once Health answered; null leaves the object pending for the next run.
export function afterOutcome(
  o: HealthObject,
  outcome: HealthOutcome,
  kept: Written | undefined,
): Written | null {
  const version = kept?.version ?? 0;
  switch (outcome) {
    case "written":
      if (o.kind === "workout")
        return { state: "workout", version: o.version, startedAt: o.startedAt, endedAt: o.endedAt };
      if (o.kind === "weighing") return { state: "weighing", version: o.version, kg: o.kg };
      return null;
    case "removed":
      return { state: "removed", version };
    case "overlap":
      return o.kind === "workout"
        ? { state: "skipped", version, startedAt: o.startedAt, endedAt: o.endedAt }
        : null;
    default:
      return null;
  }
}

// What « Envoyer l’historique » would add: the finished sessions and weigh-ins from before the
// setting went on that this phone has not written.
export function historyCounts(
  input: Pick<HealthPlanInput, "workouts" | "sets" | "weights" | "settings" | "written" | "filled">,
): { sessions: number; weighings: number } {
  const plan = planHealth({
    ...input,
    settings: { ...input.settings, on: true, history: "asked" },
    allowed: { workouts: true, weighings: true },
    // A sample's time does not count here, and the phone records nothing ahead of its clock.
    now: Infinity,
    owner: "", // nor does whose it is: the record's keys carry none
  });
  const from = input.settings.turnedOnAt ?? Infinity;
  const fromDay = input.settings.turnedOnAt === null ? "9999-12-31" : toISODate(new Date(from));
  return {
    sessions: plan.filter(
      (o) => o.kind === "workout" && o.endedAt < from && !input.written[keyOf(o)],
    ).length,
    weighings: plan.filter(
      (o) => o.kind === "weighing" && o.date < fromDay && !input.written[keyOf(o)],
    ).length,
  };
}
