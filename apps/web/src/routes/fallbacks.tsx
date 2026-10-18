import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

export function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-title-lg">{t("fallback.notFoundTitle")}</h1>
      <p>{t("fallback.notFoundBody")}</p>
      <Button asChild variant="secondary" className="self-start">
        <Link to="/">{t("fallback.backHome")}</Link>
      </Button>
    </section>
  );
}

// Also what a lazy page shows when its chunk failed to load (an update removed the old file):
// a reload fetches the new one.
export function RouteError() {
  const { t } = useTranslation();
  return (
    <section role="alert" className="flex flex-col gap-4">
      <h1 className="text-title-lg">{t("fallback.errorTitle")}</h1>
      <p>{t("fallback.errorBody")}</p>
      <Button className="self-start" onClick={() => window.location.reload()}>
        {t("fallback.reload")}
      </Button>
    </section>
  );
}

// The tab pages whose pending page shows their title: the same words the tab and the page use.
// Other pages show the mark alone, since their title depends on data or on code not loaded yet.
export const PENDING_TITLES: Readonly<Record<string, "nav.workouts" | "nav.body" | "nav.tools">> = {
  "/workouts": "nav.workouts",
  "/body": "nav.body",
  "/tools": "nav.tools",
};

// What a page shows while its code or its data is late: its title where the page will put it,
// and the breathing mark. Only the status line is read out; the page's own h1 follows.
export function Pending({ title = true }: { title?: boolean }) {
  const { t } = useTranslation();
  // The location on its way, not the one still resolved.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const key = title ? PENDING_TITLES[pathname] : undefined;
  return (
    <div data-pending className="relative flex flex-1 flex-col gap-4">
      {key && (
        <>
          {/* The page header's bar and its pull on the gap, so the title lands where the h1
              will. */}
          <div aria-hidden className="-mb-3.5 pt-[env(safe-area-inset-top)]">
            <div className="h-11" />
          </div>
          <p aria-hidden className="text-title-lg">
            {t(key)}
          </p>
        </>
      )}
      <div aria-hidden className="loader-mark">
        <span data-hook="a" />
        <span data-hook="b" />
      </div>
      <p role="status" className="sr-only">
        {t("fallback.loading")}
      </p>
    </div>
  );
}
