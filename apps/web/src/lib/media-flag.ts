import { preference } from "./preference";

// Startup-safe: whether this instance serves exercise loops, as /api/me last said, and the
// service worker's cache that holds the loops already seen.
export const MEDIA_CACHE = "belay-media";
export const [readMedia, writeMedia] = preference<"off" | "on">("belay.media", "off", "on");
