// The starter program of BRIEF §10, a constant in M3a (D10): M3b stores it and lets it change.
import type { WarmupCount } from "../tools/warmup";
import type { Slot, Workout } from "./workout";

export interface SessionTemplate {
  code: string; // "A", "B", "C": the name comes from the translations (program.sessions.A)
  slots: readonly Slot[];
}

const slot = (
  exerciseId: string,
  sets: number,
  repRange: [number, number],
  rirTarget: [number, number],
  restSec: number,
  warmupSets: WarmupCount,
  { isMain = false, groupKey = null }: { isMain?: boolean; groupKey?: string | null } = {},
): Slot => ({ exerciseId, sets, repRange, rirTarget, restSec, warmupSets, isMain, groupKey });
const main = { isMain: true };

// Groups keep BRIEF's numbers ("4", "5"); in a group only the last slot rests.
export const starterProgram: readonly SessionTemplate[] = [
  {
    code: "A", // Push
    slots: [
      slot("ds:0025", 4, [6, 8], [1, 2], 150, 2, main), // barbell bench press
      slot("ds:0405", 3, [8, 10], [1, 2], 120, 1, main), // dumbbell seated shoulder press
      slot("ds:0739", 3, [10, 12], [1, 2], 120, 2, main), // sled 45° leg press
      slot("ds:0334", 3, [12, 20], [0, 1], 0, 0, { groupKey: "4" }), // dumbbell lateral raise
      slot("ds:0201", 3, [10, 15], [0, 1], 0, 0, { groupKey: "4" }), // cable pushdown
      slot("ds:0605", 3, [10, 15], [0, 1], 75, 0, { groupKey: "4" }), // lever standing calf raise
    ],
  },
  {
    code: "B", // Legs
    slots: [
      slot("ds:0043", 4, [5, 8], [2, 2], 150, 3, main), // barbell full squat
      slot("ds:0085", 3, [6, 10], [2, 2], 150, 1, main), // barbell romanian deadlift
      slot("ds:0410", 2, [8, 12], [1, 2], 90, 0), // dumbbell single leg split squat
      slot("ds:0586", 3, [10, 15], [0, 1], 0, 0, { groupKey: "4" }), // lever lying leg curl
      slot("ds:0314", 3, [8, 12], [1, 1], 90, 1, { groupKey: "4" }), // db incline bench press
      slot("ds:0175", 3, [10, 15], [0, 1], 0, 0, { groupKey: "5" }), // cable kneeling crunch
      slot("ds:0594", 3, [12, 15], [0, 1], 60, 0, { groupKey: "5" }), // lever seated calf raise
    ],
  },
  {
    code: "C", // Glutes + light pull (8 slots: the conditional rule comes with M3b)
    slots: [
      slot("belay:barbell-hip-thrust", 4, [8, 12], [1, 2], 120, 2, main),
      slot("ds:0327", 3, [8, 12], [1, 2], 90, 1, main), // dumbbell incline row
      slot("ds:0585", 3, [10, 15], [0, 1], 90, 0), // lever leg extension
      slot("ds:0662", 2, [8, 15], [1, 1], 0, 0, { groupKey: "4" }), // push-up
      slot("belay:cable-face-pull", 2, [12, 15], [0, 1], 0, 0, { groupKey: "4" }),
      slot("ds:0334", 3, [12, 20], [0, 1], 60, 0, { groupKey: "4" }), // dumbbell lateral raise
      slot("ds:0385", 2, [15, 20], [1, 2], 0, 0, { groupKey: "5" }), // dumbbell reverse wrist curl
      slot("ds:0872", 2, [10, 15], [1, 2], 60, 0, { groupKey: "5" }), // reverse crunch
    ],
  },
];

export const sessionByCode = (code: string): SessionTemplate | undefined =>
  starterProgram.find((s) => s.code === code);

// The slot indexes of a slot's group (consecutive slots of one groupKey), or the slot alone.
export function groupOf(plan: readonly Slot[], slotIndex: number): number[] {
  const key = plan[slotIndex]?.groupKey ?? null;
  if (key === null) return [slotIndex];
  let first = slotIndex;
  while (first > 0 && plan[first - 1]!.groupKey === key) first--;
  const out: number[] = [];
  for (let i = first; i < plan.length && plan[i]!.groupKey === key; i++) out.push(i);
  return out;
}

// The next session after the last one finished (D11): A → B → C → A; A with no history.
export function nextSession(
  workouts: readonly Pick<Workout, "sessionCode" | "startedAt" | "endedAt" | "removed">[],
  program: readonly SessionTemplate[] = starterProgram,
): string {
  const last = workouts
    .filter((w) => w.endedAt !== null && !w.removed)
    .reduce<(typeof workouts)[number] | null>(
      (latest, w) => (latest === null || w.startedAt > latest.startedAt ? w : latest),
      null,
    );
  const at = last ? program.findIndex((s) => s.code === last.sessionCode) : -1;
  return program[(at + 1) % program.length]!.code;
}

// Every set, warm-ups included, takes 45 s plus its slot's rest; rounded to 5 minutes.
export function estimatedMinutes(session: SessionTemplate): number {
  const seconds = session.slots.reduce((s, x) => s + (x.sets + x.warmupSets) * (45 + x.restSec), 0);
  return Math.max(5, Math.round(seconds / 300) * 5);
}

export const plannedWorkSets = (plan: readonly Slot[]) => plan.reduce((n, s) => n + s.sets, 0);
