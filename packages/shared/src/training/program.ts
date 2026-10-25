// The starter program, a constant until the program editor stores it.
import type { WarmupCount } from "../tools/warmup";
import type { Slot } from "./workout";

export interface SessionTemplate {
  code: string; // "A", "B", "C": the name comes from the translations (program.sessions.A)
  slots: readonly Slot[];
  // The slots added at the end of the session in a week with no climbing (its conditional rule).
  noClimbing?: readonly Slot[];
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

// Groups keep the program's own numbers ("4", "5"); in a group only the last slot rests.
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
    code: "C", // Glutes + light pull, and a vertical pull and a curl in a week with no climbing
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
    noClimbing: [
      slot("ds:2330", 3, [8, 12], [1, 2], 90, 1), // cable lat pulldown, full range of motion
      slot("ds:0294", 2, [10, 15], [0, 1], 60, 0), // dumbbell biceps curl
    ],
  },
];

// What the program offers instead of an exercise (spec D14), by exercise id: the squat, the
// split squat, the push-up and the Romanian deadlift.
// ponytail: a constant beside the constant program; the stored program (M3b2) gives each slot
// its own alternatives.
export const ALTERNATIVES: Readonly<Record<string, readonly string[]>> = {
  "ds:0043": ["ds:1760", "ds:0739"], // barbell full squat → dumbbell goblet squat, leg press
  "ds:0410": ["ds:0431"], // dumbbell single leg split squat → dumbbell step-up
  "ds:0662": ["ds:0493", "ds:0576"], // push-up → incline push-up, lever chest press
  "ds:0085": ["ds:1459"], // barbell romanian deadlift → dumbbell romanian deadlift
};
export const alternativesOf = (exerciseId: string): readonly string[] =>
  ALTERNATIVES[exerciseId] ?? [];

// Every caller passes the stored rotation.
export const sessionByCode = (
  code: string,
  program: readonly SessionTemplate[],
): SessionTemplate | undefined => program.find((s) => s.code === code);

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

// Every set, warm-ups included, takes 45 s plus its slot's rest; rounded to 5 minutes. A slot
// skipped for the session counts for nothing.
export function estimatedMinutes({ slots }: { slots: readonly Slot[] }): number {
  const seconds = slots
    .filter((x) => !x.skipped)
    .reduce((s, x) => s + (x.sets + x.warmupSets) * (45 + x.restSec), 0);
  return Math.max(5, Math.round(seconds / 300) * 5);
}

// The work sets the plan asks for, a skipped slot's aside.
export const plannedWorkSets = (plan: readonly Slot[]) =>
  plan.reduce((n, s) => n + (s.skipped ? 0 : s.sets), 0);
