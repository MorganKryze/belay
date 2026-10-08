import i18n from "./index";
import en from "./lazy/en.json";
import fr from "./lazy/fr.json";

// The strings of screens that load on demand stay out of the initial bundle: the first of those
// screens to load adds them to the translation (deep, never replacing a key). Each one imports
// this module before it renders.
i18n.addResourceBundle("en", "translation", en, true, false);
i18n.addResourceBundle("fr", "translation", fr, true, false);
