import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { within } from "@testing-library/react";

export const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d${String(n).padStart(2, "0")}`;
// A session started at `start` (the phone's local time), its sets, and its end `minutes` later.
export function session(
  n: number,
  code: string,
  start: Date,
  minutes: number | null,
  sets: [slotIndex: number, position: number, kg: number, reps: number, rir: number | null][] = [],
): Change[] {
  const startedAt = start.toISOString();
  const end = minutes === null ? null : new Date(start.getTime() + minutes * 60_000).toISOString();
  const at = end ?? startedAt;
  const plan = [...sessionByCode(code, starterProgram)!.slots];
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: code,
      plan,
      startedAt,
      at: startedAt,
    },
    ...sets.map(([slotIndex, position, weightKg, reps, rir], i): Change => ({
      kind: "set",
      id: id(n * 10 + i),
      workoutId: id(n),
      field: "create",
      slotIndex,
      position,
      exerciseId: plan[slotIndex]!.exerciseId,
      warmup: position < 3,
      weightKg,
      reps,
      rir,
      doneAt: startedAt,
      at: startedAt,
    })),
    ...(end ? [{ kind: "workout", id: id(n), field: "ended", value: end, at } as Change] : []),
  ];
}

export const MONTH: Change[] = [
  ...session(1, "A", new Date(2026, 9, 2, 18, 0), 64),
  ...session(2, "B", new Date(2026, 9, 5, 18, 0), 58, [
    [0, 0, 60, 5, null],
    [0, 3, 100, 5, 2],
    [0, 4, 100, 5, 4],
  ]),
  // Begun at 23:30 on the 6th, finished at 00:40 on the 7th: it stays on the 6th.
  ...session(3, "C", new Date(2026, 9, 6, 23, 30), 70),
  ...session(4, "A", new Date(2026, 9, 3, 18, 0), 50),
  { kind: "workout", id: id(4), field: "removed", value: true, at: "2026-10-04T08:00:00.000Z" },
  ...session(5, "A", new Date(2026, 9, 7, 7, 0), null), // in progress
];

export const marked = (calendar: HTMLElement) =>
  within(calendar)
    .getAllByText(", session")
    .map((s) => s.parentElement!.textContent!.replace(", session", ""));
