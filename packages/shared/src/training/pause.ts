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

// What a pause stops, a choice each device keeps: everything, or the session's time while the
// rest keeps running.
export type PauseStops = "all" | "session";

// The moment the rest is read at: while everything stops, the pause's beginning (never later
// than now, a clock put back during the pause), so the rest left stands still.
export function restClock(
  pausedAt: string | null | undefined,
  now: number,
  stops: PauseStops,
): number {
  return stops === "all" && pausedAt ? Math.min(now, Date.parse(pausedAt)) : now;
}

// The rest's end once the pause is left. When everything stopped, a rest still running at the
// pause ends later by the time paused, so it goes on from the time it had left; never earlier
// (a clock put back during the pause). Both values live on the device, so a reload reads the
// same frozen rest and nothing new is sent.
export function resumedRestEnd(
  restEndsAt: string | null,
  pausedAt: string,
  resumedAt: string,
  stops: PauseStops,
): string | null {
  if (stops !== "all" || restEndsAt === null) return restEndsAt;
  const end = Date.parse(restEndsAt);
  const paused = Date.parse(pausedAt);
  if (end <= paused) return restEndsAt;
  return new Date(end + Math.max(0, Date.parse(resumedAt) - paused)).toISOString();
}
