import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import fr from "./fr.json";

export const LOCALES = ["en", "fr"] as const;
export type Locale = (typeof LOCALES)[number];
const KEY = "belay.locale";

const isLocale = (v: string | null | undefined): v is Locale =>
  (LOCALES as readonly string[]).includes(v ?? "");

export function detectLocale(stored: string | null, preferred: readonly string[]): Locale {
  if (isLocale(stored)) return stored;
  for (const tag of preferred) {
    const base = tag.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return "en";
}

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLocale(locale: Locale) {
  void i18n.changeLanguage(locale);
  try {
    localStorage.setItem(KEY, locale);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
}

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, fr: { translation: fr } },
  lng: detectLocale(readStored(), navigator.languages ?? []),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
