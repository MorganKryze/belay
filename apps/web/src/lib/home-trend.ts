// Whether Accueil shows the weight trend. Someone who would rather not meet a weight figure each
// time the app opens can hide it there; Body keeps it.
export type HomeTrend = "shown" | "hidden";

const KEY = "belay.homeTrend";

// Where storage refuses the choice (some private modes), it lives here for the visit.
let fallback: HomeTrend = "shown";

// A device preference, as the theme and the pause: read on each use, never synced.
export function readHomeTrend(): HomeTrend {
  try {
    return localStorage.getItem(KEY) === "hidden" ? "hidden" : "shown";
  } catch {
    return fallback;
  }
}

export function setHomeTrend(choice: HomeTrend) {
  fallback = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Storage refused: the choice holds for this visit only, through the fallback above.
  }
}

// Whether the trend shows its range pill, on Accueil and on Corps: someone can keep the figure
// without being told whether it sits in range. Kept here, not with the lazy preferences, because
// Accueil reads it at startup.
const PILL_KEY = "belay.rangePill";

let pillFallback: HomeTrend = "shown";

export function readRangePill(): HomeTrend {
  try {
    return localStorage.getItem(PILL_KEY) === "hidden" ? "hidden" : "shown";
  } catch {
    return pillFallback;
  }
}

export function setRangePill(choice: HomeTrend) {
  pillFallback = choice;
  try {
    localStorage.setItem(PILL_KEY, choice);
  } catch {
    // Storage refused: the choice holds for this visit only, through the fallback above.
  }
}
