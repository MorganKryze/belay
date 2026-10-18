import type { PauseStops } from "@belay/shared/training/pause";

const KEY = "belay.pauseStops";

// A device preference, as the theme: read on each use, never synced.
export function readPauseStops(): PauseStops {
  try {
    return localStorage.getItem(KEY) === "session" ? "session" : "all";
  } catch {
    return "all";
  }
}

export function setPauseStops(stops: PauseStops) {
  try {
    localStorage.setItem(KEY, stops);
  } catch {
    // Storage refused (some private modes): the default stays, as nothing holds the choice.
  }
}
