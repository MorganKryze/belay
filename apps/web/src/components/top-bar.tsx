import { Link, useLocation } from "@tanstack/react-router";
import { Calculator, Dumbbell, House, PersonStanding } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AvatarLink } from "@/components/avatar";
import { tabIndexOf } from "@/components/tab-bar";

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
// 3:1 where the fill alone would not.
export function TopBar({ name }: { name?: string }) {
  const { t } = useTranslation();
  const active = tabIndexOf(useLocation().pathname);
  return (
    <header className="sticky top-0 z-30 hidden h-(--top-bar) [view-transition-name:top-bar] items-center border-b border-border bg-surface px-6 lg:flex">
      <div className="mx-auto flex w-full max-w-5xl items-center gap-6">
        <Link
          to="/"
          className="flex min-h-11 items-center gap-2 text-title-compact text-foreground"
        >
          <svg aria-hidden="true" viewBox="86 86 340 340" className="size-7 shrink-0 text-primary">
            <path
              fill="currentColor"
              d="M86 160L86 266A120 120 0 0 0 326 266L326 246A20 20 0 0 0 286 246L286 266A80 80 0 0 1 126 266L126 160A20 20 0 0 0 86 160ZM426 352L426 246A120 120 0 0 0 186 246L186 266A20 20 0 0 0 226 266L226 246A80 80 0 0 1 386 246L386 352A20 20 0 0 0 426 352Z"
            />
          </svg>
          {t("app.name")}
        </Link>
        <nav className="flex-1">
          <ul className="flex gap-1">
            {SECTIONS.map(({ to, label, Icon }, i) => (
              <li key={to}>
                {/* As in the dock, aria-current comes from tabIndexOf alone. */}
                <Link
                  to={to}
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
