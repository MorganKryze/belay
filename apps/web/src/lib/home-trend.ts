// Two device preferences read at startup, kept apart from the lazy ones so Accueil loads light: as
// the theme and the pause, read on each use, never synced.
export type HomeTrend = "shown" | "hidden";

// One preference stored under `key`. Where storage refuses the choice (some private modes), it
// lives in memory for the visit.
function preference(key: string) {
  let fallback: HomeTrend = "shown";
  return {
    read(): HomeTrend {
      try {
        return localStorage.getItem(key) === "hidden" ? "hidden" : "shown";
      } catch {
        return fallback;
      }
    },
    set(choice: HomeTrend) {
      fallback = choice;
      try {
        localStorage.setItem(key, choice);
      } catch {
        // Storage refused: the choice holds for this visit only, through the fallback above.
      }
    },
  };
}

// Whether Accueil shows the weight trend. Someone who would rather not meet a weight figure each
// time the app opens can hide it there; Body keeps it.
const homeTrend = preference("belay.homeTrend");
export const readHomeTrend = homeTrend.read;
export const setHomeTrend = homeTrend.set;

// Whether the trend shows its range pill, on Accueil and on Corps: someone can keep the figure
// without being told whether it sits in range.
const rangePill = preference("belay.rangePill");
export const readRangePill = rangePill.read;
export const setRangePill = rangePill.set;
