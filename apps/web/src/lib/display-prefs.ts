// What the history and a past session show: someone can keep Historique to their sessions, and
// leave out the volume a session sums up. Device preferences, as the theme and the pause: read on
// each use, never synced.
import { preference as device } from "./preference";

export type Shown = "shown" | "hidden";

const preference = (key: string) => device<Shown>(key, "shown", "hidden");

// Whether Historique lists activities beside the sessions.
export const [readHistoryActivities, setHistoryActivities] = preference("belay.historyActivities");

// Whether a past session and its summary show the volume.
export const [readSessionVolume, setSessionVolume] = preference("belay.sessionVolume");

// Whether Corps' weeks show the weekly intake, for someone who would rather not see what they eat.
export const [readWeekIntake, setWeekIntake] = preference("belay.weekIntake");

// Whether Outils' 1RM shows Brzycki beside Epley, for someone who would rather keep one figure.
export const [readBrzycki, setBrzycki] = preference("belay.oneRepMaxBrzycki");

// Whether Outils says where a prefilled field's value comes from, for someone who already knows.
export const [readFieldSources, setFieldSources] = preference("belay.fieldSources");
