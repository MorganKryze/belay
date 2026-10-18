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
