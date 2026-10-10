import { useEffect, useState } from "react";

// §4.6: the screen stays on while the session screen is open, asked again each time the page
// comes back to the front (the browser lets go of it in the background), let go when leaving.
// Without the Wake Lock API, nothing happens and nothing is said.
export function useWakeLock(): void {
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let left = false;
    const request = () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return;
      navigator.wakeLock.request("screen").then(
        (l) => {
          if (left) void l.release().catch(() => {});
          else lock = l;
        },
        () => {}, // refused (battery saver, no permission): the screen may sleep
      );
    };
    request();
    document.addEventListener("visibilitychange", request);
    return () => {
      left = true;
      document.removeEventListener("visibilitychange", request);
      void lock?.release().catch(() => {});
    };
  }, []);
}

// The clock, read again every `ms`: the elapsed time and the rest are computed from it, never
// counted, so a page put to sleep shows the right time as soon as it wakes.
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms]);
  return now;
}

// "1:48", "24:10", "1:04:10". A countdown rounds up (it reads 0:00 only once over), an elapsed
// time down.
export function formatClock(ms: number, round: (x: number) => number = Math.ceil): string {
  const total = Math.max(0, round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
