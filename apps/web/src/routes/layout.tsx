import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { TabBar } from "@/components/tab-bar";
import { useOnline } from "@/lib/online";

export function Layout() {
  const { t } = useTranslation();
  const online = useOnline();
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-6 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
      {/* Mounted for good and filled when offline, so the change is announced. */}
      <p role="status" className={online ? "sr-only" : "rounded-chip bg-track p-3 text-sm"}>
        {online ? "" : t("offline")}
      </p>
      <main>
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}
