// Two device preferences read at startup, kept apart from the lazy ones so Accueil loads light: as
// the theme and the pause, read on each use, never synced.
import { preference } from "./preference";

export type HomeTrend = "shown" | "hidden";

const trendPref = (key: string) => preference<HomeTrend>(key, "shown", "hidden");

// Whether Accueil shows the weight trend. Someone who would rather not meet a weight figure each
// time the app opens can hide it there; Body keeps it.
export const [readHomeTrend, setHomeTrend] = trendPref("belay.homeTrend");

// Whether the trend shows its range pill, on Accueil and on Corps: someone can keep the figure
// without being told whether it sits in range.
export const [readRangePill, setRangePill] = trendPref("belay.rangePill");
