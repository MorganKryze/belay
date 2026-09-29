import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/lib/online";

export function Layout() {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 p-4">
      {!online && (
        <p role="status" className="rounded-md bg-muted p-3 text-sm">
          {t("offline")}
        </p>
      )}
      <nav className="flex gap-4 text-sm">
        <Link to="/" className="min-h-11 content-center">
          {t("nav.home")}
        </Link>
        <Link to="/settings" className="min-h-11 content-center">
          {t("nav.settings")}
        </Link>
      </nav>
      <main>
        <Outlet />
      </main>
    </div>
  );
}
