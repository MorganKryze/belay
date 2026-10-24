import { preference } from "./preference";

// The program editor's tastes on this device, the default first: how a rest reads (« 2 min 30 » or
// « 2:30 »), whether rows show their thumbnail, when the keyboard help shows, and which values a
// newly added row takes.
export const [readRestStyle, setRestStyle] = preference("belay.editorRest", "words", "clock");
export const [readThumbs, setThumbs] = preference("belay.editorThumbs", "shown", "hidden");
export const [readHelp, setHelp] = preference("belay.editorHelp", "always", "focus");
export const [readAdded, setAdded] = preference("belay.editorAdded", "defaults", "above");
