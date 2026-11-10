import { Link, useLocation } from "@tanstack/react-router";
import { Calculator, Dumbbell, House, PersonStanding } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AvatarLink } from "@/components/avatar";
import { tabIndexOf, useTabClick } from "@/components/tab-bar";

const SECTIONS = [
  { to: "/", label: "nav.home", Icon: House },
  { to: "/workouts", label: "nav.workouts", Icon: Dumbbell },
  { to: "/body", label: "nav.body", Icon: PersonStanding },
  { to: "/tools", label: "nav.tools", Icon: Calculator },
] as const;

const section =
  "press-tint flex min-h-11 items-center gap-2 rounded-control px-4 font-semibold text-muted-foreground";

// On a computer the dock gives way to this bar: plain surface rather than glass, as nothing
// scrolls under it at that width. The active section keeps the dock's edge so the cue holds at
// 3:1 where the fill alone would not. The lockup is ink here, the logotype naming the app: blue
// beside content is kept for the screen's next action.
export function TopBar({ name }: { name?: string }) {
  const { t } = useTranslation();
  const active = tabIndexOf(useLocation().pathname);
  const onClick = useTabClick();
  return (
    <header className="sticky top-0 z-30 hidden h-(--top-bar) [view-transition-name:top-bar] items-center border-b border-border bg-surface px-6 lg:flex app:hidden">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-6">
        {/* The brand and the sections change section like the dock does, by the same click: the
            page left there comes back, with no page transition. */}
        <Link
          to="/"
          onClick={onClick(0)}
          viewTransition={false}
          className="flex min-h-11 items-center text-foreground"
        >
          <span role="img" aria-label={t("app.name")} className="brand-lockup" />
        </Link>
        <nav className="flex-1">
          <ul className="flex gap-1">
            {SECTIONS.map(({ to, label, Icon }, i) => (
              <li key={to}>
                {/* As in the dock, aria-current comes from tabIndexOf alone. */}
                <Link
                  to={to}
                  onClick={onClick(i as 0 | 1 | 2 | 3)}
                  viewTransition={false}
                  activeOptions={{ exact: true, includeSearch: false }}
                  aria-current={i === active ? "page" : undefined}
                  className={
                    i === active
                      ? `${section} bg-primary-soft text-primary-ink ring-[1.5px] ring-primary-ink ring-inset`
                      : section
                  }
                >
                  <Icon aria-hidden className="size-5" />
                  {t(label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <AvatarLink name={name} />
      </div>
    </header>
  );
}
