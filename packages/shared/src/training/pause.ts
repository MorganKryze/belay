// A paused session. Since when it is paused stays on the device that paused it; on resume the
// session's start moves later by the time paused, so every device and the recorded duration
// leave the pause out without a new synced value.

// The session's time in ms: the clock stops at the pause, and never reads below zero (a start
// moved later elsewhere than this device's pause).
export function sessionElapsed(
  startedAt: string,
  pausedAt: string | null | undefined,
  now: number,
): number {
  const end = pausedAt ? Date.parse(pausedAt) : now;
  return Math.max(0, end - Date.parse(startedAt));
}

// The start once the pause is left out: later by the time paused, counted from the start when
// another device moved it past the pause's beginning. Never earlier than the start (a clock put
// back during the pause), and never after the resume, which a start must not pass.
export function resumedStart(startedAt: string, pausedAt: string, resumedAt: string): string {
  const start = Date.parse(startedAt);
  const resumed = Date.parse(resumedAt);
  const paused = Math.max(Date.parse(pausedAt), start);
  return new Date(Math.min(start + Math.max(0, resumed - paused), resumed)).toISOString();
}

// A set logged after the pause began ends it, at that set's time: the first such set, or null.
export function pauseEndedBy(pausedAt: string, doneAts: readonly string[]): string | null {
  const paused = Date.parse(pausedAt);
  let first: string | null = null;
  for (const doneAt of doneAts)
    if (Date.parse(doneAt) > paused && (first === null || Date.parse(doneAt) < Date.parse(first)))
      first = doneAt;
  return first;
}
