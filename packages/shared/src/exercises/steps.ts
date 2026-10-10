import type { Steps } from "./library";

// "How to do it" in the app's language: one file per language, loaded the first time a sheet
// needs it (about 80 KiB gzip each).
export const loadSteps = async (locale: string): Promise<Steps> =>
  (locale.startsWith("fr") ? await import("./data/fr.json") : await import("./data/en.json"))
    .default;
