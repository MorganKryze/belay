import { Link } from "@tanstack/react-router";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";

// Réglages left the tab bar: this round link on Accueil's title opens it. Screen readers hear
// "Réglages"; the initial, or a person icon before a name is known, is only a picture of it.
export function AvatarLink({ name }: { name?: string }) {
  const { t } = useTranslation();
  const initial = name ? Array.from(name.trim())[0]?.toLocaleUpperCase() : undefined;
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
