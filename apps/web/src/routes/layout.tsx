import { Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { TabBar } from "@/components/tab-bar";
import { useOnline } from "@/lib/online";
import { AccountProvider, useAccount } from "@/sync/account";

export function Layout() {
  return (
    <AccountProvider>
      <Shell />
    </AccountProvider>
  );
}

function Shell() {
  const { t } = useTranslation();
  const online = useOnline();
  const account = useAccount();
  // Signed in, the sync banner of Home and Body speaks instead: offline with nothing waiting
  // needs no banner at all (§4.6).
  const offline = !online && account.kind !== "open";
  const router = useRouter();
  // The session and its summary are full screen: no tab bar (§4.2).
  const fullScreen = /^\/workout(\/|$)/.test(useLocation().pathname);
  // A client navigation lands focus on the new page's h1, so screen readers announce it. The
  // first load (no fromLocation) is left alone: the browser starts at the top already. A lazy
  // route mounts its h1 after the event, so wait for it.
  useEffect(() => {
    let watch: MutationObserver | undefined;
    const focusH1 = () => {
      const h1 = document.querySelector<HTMLElement>("main h1");
      if (!h1) return false;
      h1.setAttribute("tabindex", "-1");
      h1.focus({ preventScroll: true });
      return true;
    };
    const off = router.subscribe("onRendered", ({ fromLocation, pathChanged }) => {
      if (!fromLocation || !pathChanged) return;
      watch?.disconnect();
      if (focusH1()) return;
      watch = new MutationObserver(() => focusH1() && watch?.disconnect());
      watch.observe(document.body, { childList: true, subtree: true });
    });
    return () => {
      off();
      watch?.disconnect();
    };
  }, [router]);
  return (
    <div
      className={`mx-auto flex min-h-dvh max-w-xl flex-col gap-6 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] ${
        fullScreen
          ? "pb-[max(1rem,env(safe-area-inset-bottom))]"
          : "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
      }`}
    >
      {/* Mounted for good and filled when offline, so the change is announced. */}
      <p role="status" className={offline ? "rounded-chip bg-track p-3 text-sm" : "sr-only"}>
        {offline ? t("offline") : ""}
      </p>
      <main>
        <Outlet />
      </main>
      {!fullScreen && <TabBar />}
    </div>
  );
}
