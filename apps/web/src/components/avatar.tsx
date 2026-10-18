import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

// The first letter of a name, by code point so a letter outside the basic plane stays whole.
export function initialOf(name: string): string | undefined {
  return Array.from(name.trim())[0]?.toLocaleUpperCase();
}

// Réglages left the tab bar: this round link on Accueil's title opens it. Screen readers hear
// "Réglages"; the initial, or a person icon before a name is known, is only a picture of it.
export function AvatarLink({ name }: { name?: string }) {
  const { t } = useTranslation();
  const initial = initialOf(name ?? "");
  return (
    <Link
      to="/settings"
      aria-label={t("nav.settings")}
      className="press grid size-11 shrink-0 place-items-center rounded-round bg-track text-button font-bold text-foreground"
    >
      {initial ? <span aria-hidden>{initial}</span> : <UserRound aria-hidden className="size-6" />}
    </Link>
  );
}
