import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALES, setLocale, type Locale } from "@/i18n";
import { readTheme, setTheme, type Theme } from "@/lib/theme";

const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", fr: "Français" };

export function Settings() {
  const { t, i18n } = useTranslation();
  const [theme, setThemeState] = useState<Theme>(readTheme);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-3xl font-semibold">{t("settings.title")}</h1>

      <div className="flex flex-col gap-2">
        <Label htmlFor="language">{t("settings.language")}</Label>
        <Select value={i18n.language} onValueChange={(v) => setLocale(v as Locale)}>
          <SelectTrigger id="language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALES.map((l) => (
              <SelectItem key={l} value={l} lang={l}>
                {LANGUAGE_NAMES[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="theme">{t("settings.theme")}</Label>
        <Select
          value={theme}
          onValueChange={(v) => {
            setTheme(v as Theme);
            setThemeState(v as Theme);
          }}
        >
          <SelectTrigger id="theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["light", "dark", "system"] as const).map((th) => (
              <SelectItem key={th} value={th}>
                {t(`settings.themes.${th}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </section>
  );
}
