// The mark stays at least this long once painted, so it reads as a mark and not a flash.
export const LAUNCH_HOLD_MS = 1000;
// An answer that never comes must not keep the launch screen up.
export const LAUNCH_SAFETY_MS = 4000;

// ms still to wait before the launch screen may leave; 0 when the hold is over.
// paintedAt undefined: not painted yet as far as the browser says, so the hold starts now.
export function launchHoldLeft(now: number, paintedAt: number | undefined): number {
  // Rounded up: a timer may fire a fraction of a millisecond early, and the hold is a floor.
  return Math.max(0, Math.ceil((paintedAt ?? now) + LAUNCH_HOLD_MS - now));
}

// The first contentful paint is the launch screen's: it sits in the page before any script.
export function paintedAt(): number | undefined {
  return performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
}
