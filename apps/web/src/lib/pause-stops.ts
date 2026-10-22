import type { PauseStops } from "@belay/shared/training/pause";
import { preference } from "./preference";

// A device preference, as the theme: read on each use, never synced.
export const [readPauseStops, setPauseStops] = preference<PauseStops>(
  "belay.pauseStops",
  "all",
  "session",
);
