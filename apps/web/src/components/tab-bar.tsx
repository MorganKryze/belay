import { Link, useLocation } from "@tanstack/react-router";
import { Calculator, Dumbbell, House, PersonStanding } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";

const TABS = [
  { to: "/", label: "nav.home", Icon: House },
  { to: "/workouts", label: "nav.workouts", Icon: Dumbbell },
  { to: "/body", label: "nav.body", Icon: PersonStanding },
  { to: "/tools", label: "nav.tools", Icon: Calculator },
] as const;

// The one place that says which tab a page belongs to. An exercise belongs to Séances, whose
// library opens it; every tool page to Outils. The session cover ("/workout") is in no tab.
export function tabIndexOf(pathname: string): 0 | 1 | 2 | 3 | null {
  if (pathname === "/") return 0;
  if (/^\/(?:workouts(?:\/|$)|exercises\/)/.test(pathname)) return 1;
  if (/^\/body(?:\/|$)/.test(pathname)) return 2;
  if (/^\/tools(?:\/|$)/.test(pathname)) return 3;
  return null;
}

const tab =
  "press-tint press-icon flex min-h-12.5 flex-col items-center justify-center gap-0.5 rounded-card text-tab text-muted-foreground";

// Floating on its own, or with the session bar above it: then one frosted backing runs from the
// bar's top to the bottom edge, so no row of the page shows between the two.
const floating =
  "fixed right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))] z-10 mx-auto max-w-xl";
const backed =
  "fixed inset-x-0 bottom-0 z-10 border-t border-border glass pt-2.5 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))]";

export function TabBar({ above }: { above?: ReactNode }) {
  const { t } = useTranslation();
  const active = tabIndexOf(useLocation().pathname);
  return (
    // The wrapper is what fades under an open dialog (index.css).
    <div data-dock className={above ? backed : floating}>
      {above && <div className="mx-auto mb-2 max-w-xl">{above}</div>}
      <nav
        aria-label={t("nav.label")}
        className={`relative mx-auto max-w-xl rounded-bar border border-border p-1.5 ${
          above ? "bg-surface" : "glass shadow-float"
        }`}
        style={{ "--tab-i": active ?? 0 } as CSSProperties}
      >
        {/* One pill for the bar, slid to the active column; its edge keeps the cue at 3:1 where
            the fill alone would not. */}
        {active !== null && (
          <span
            aria-hidden
            data-pill
            className="absolute inset-y-1.5 left-1.5 w-[calc((100%-0.75rem)/4)] translate-x-[calc(var(--tab-i)*100%)] rounded-card bg-tab-pill ring-[1.5px] ring-primary-ink ring-inset transition-transform duration-(--pill-duration) ease-pill"
          />
        )}
        <ul className="relative grid grid-cols-4">
          {TABS.map(({ to, label, Icon }, i) => (
            <li key={to}>
              {/* Exact matching keeps the router from marking a tab on its own: on deeper pages
                  aria-current comes from tabIndexOf alone. A tab change is never a step back,
                  even from a deeper page, so it runs no page transition. */}
              <Link
                to={to}
                viewTransition={false}
                activeOptions={{ exact: true, includeSearch: false }}
                aria-current={i === active ? "page" : undefined}
                className={i === active ? `${tab} font-bold text-primary-ink` : tab}
              >
                <Icon aria-hidden className="size-6" />
                {t(label)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
