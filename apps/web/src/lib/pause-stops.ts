import type { PauseStops } from "@belay/shared/training/pause";

const KEY = "belay.pauseStops";

// Where storage refuses the choice (some private modes), it lives here for the visit, so the
// screens follow what Settings shows until the page closes.
let fallback: PauseStops = "all";

// A device preference, as the theme: read on each use, never synced.
export function readPauseStops(): PauseStops {
  try {
    return localStorage.getItem(KEY) === "session" ? "session" : "all";
  } catch {
    return fallback;
  }
}

export function setPauseStops(stops: PauseStops) {
  fallback = stops;
  try {
    localStorage.setItem(KEY, stops);
  } catch {
    // Storage refused: the choice holds for this visit only, through the fallback above.
  }
}
