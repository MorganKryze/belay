// The mark stays at least this long once painted, so it reads as a mark and not a flash.
export const LAUNCH_HOLD_MS = 1000;
// An answer or a paint that never comes must not keep the launch screen up.
export const LAUNCH_SAFETY_MS = 4000;

// ms still to wait before the launch screen may leave; 0 when the hold is over.
export function launchHoldLeft(now: number, paintedAt: number): number {
  // Rounded up: a timer may fire a fraction of a millisecond early, and the hold is a floor.
  return Math.max(0, Math.ceil(paintedAt + LAUNCH_HOLD_MS - now));
}

// The first contentful paint is the launch screen's: it sits in the page before any script.
function paintedAt(): number | undefined {
  return performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
}

// Calls back with the first paint's time once there is one. A slow device may run the scripts
// before it paints; a browser without paint entries gets the second frame instead.
function whenPainted(done: (at: number) => void): () => void {
  const at = paintedAt();
  if (at !== undefined) {
    done(at);
    return () => {};
  }
  if (globalThis.PerformanceObserver?.supportedEntryTypes.includes("paint")) {
    const watch = new PerformanceObserver((list) => {
      const paint = list.getEntriesByName("first-contentful-paint")[0];
      if (!paint) return;
      watch.disconnect();
      done(paint.startTime);
    });
    watch.observe({ type: "paint", buffered: true });
    return () => watch.disconnect();
  }
  let frame = requestAnimationFrame(() => {
    frame = requestAnimationFrame(() => done(performance.now()));
  });
  return () => cancelAnimationFrame(frame);
}

// Calls launch once the account is known and the mark has held its second since the first
// paint, or at the safety delay after start whatever happens. Returns the cleanup.
export function holdLaunch(known: boolean, launch: () => void, start: number): () => void {
  const safety = setTimeout(launch, Math.max(0, start + LAUNCH_SAFETY_MS - performance.now()));
  if (!known) return () => clearTimeout(safety);
  let hold: ReturnType<typeof setTimeout> | undefined;
  const stopWatch = whenPainted((at) => {
    hold = setTimeout(launch, launchHoldLeft(performance.now(), at));
  });
  return () => {
    clearTimeout(safety);
    clearTimeout(hold);
    stopWatch();
  };
}
