import { Link, useLocation } from "@tanstack/react-router";
import { Calculator, Dumbbell, House, PersonStanding, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";

// Link sets data-status="active" and aria-current="page" on the current tab. "/tools" stays
// active on every tool page; "/" only on the home page.
const tab =
  "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-chip text-xs font-medium text-muted-foreground data-[status=active]:font-bold data-[status=active]:text-primary";

export function TabBar() {
  const { t } = useTranslation();
  // An exercise's sheet belongs to the Sessions tab, whose library opened it.
  const inLibrary = useLocation().pathname.startsWith("/exercises/");
  return (
    <nav
      aria-label={t("nav.label")}
      className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5 px-[max(0.5rem,env(safe-area-inset-left))] pt-1.5 pb-2">
        <li>
          <Link to="/" activeOptions={{ exact: true }} className={tab}>
            <House aria-hidden className="size-[22px]" />
            {t("nav.home")}
          </Link>
        </li>
        <li>
          <Link to="/workouts" className={inLibrary ? `${tab} font-bold text-primary` : tab}>
            <Dumbbell aria-hidden className="size-[22px]" />
            {t("nav.workouts")}
          </Link>
        </li>
        <li>
          <Link to="/body" className={tab}>
            <PersonStanding aria-hidden className="size-[22px]" />
            {t("nav.body")}
          </Link>
        </li>
        <li>
          <Link to="/tools" className={tab}>
            <Calculator aria-hidden className="size-[22px]" />
            {t("nav.tools")}
          </Link>
        </li>
        <li>
          <Link to="/settings" className={tab}>
            <Settings aria-hidden className="size-[22px]" />
            {t("nav.settings")}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
