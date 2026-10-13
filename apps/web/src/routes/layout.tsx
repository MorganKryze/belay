import { Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { liveSets, openWorkout } from "@belay/shared/training/rules";
import { lazy, Suspense, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TabBar } from "@/components/tab-bar";
import { UpdateBanner } from "@/components/update-banner";
import { useOnline } from "@/lib/online";
import { usePresence } from "@/lib/presence";
import { type Account, AccountProvider, useAccount, useHistory } from "@/sync/account";

// The bar names exercises: it loads on demand, so the catalogue stays out of the shell.
const SessionBar = lazy(() =>
  import("@/components/session-bar").then((m) => ({ default: m.SessionBar })),
);

const TAB_ROOTS = ["/", "/workouts", "/body", "/tools"];

export function Layout() {
  return (
    <AccountProvider>
      <Shell />
    </AccountProvider>
  );
}

// The open session and its sets, for the bar above the tabs; null when nothing is open.
function useOpenSession(account: Account) {
  const history = useHistory(account.kind === "open" ? account : null).data;
  return useMemo(() => {
    if (account.kind !== "open" || !history) return null;
    const workout = openWorkout(history.workouts, { sets: history.sets, now: new Date() });
    if (!workout) return null;
    return { workout, sets: liveSets(history).filter((s) => s.workoutId === workout.id) };
  }, [account.kind, history]);
}

function Shell() {
  const { t } = useTranslation();
  const online = useOnline();
  const account = useAccount();
  // Signed in, the sync banner of Home and Body speaks instead: offline with nothing waiting
  // needs no banner at all (§4.6).
  const offline = !online && account.kind !== "open";
  const router = useRouter();
  const { pathname } = useLocation();
  // The session and its summary are full screen covers, and Réglages with its pages is pushed
  // from the avatar, outside every tab: no dock on either (§4.2).
  const docked = !/^\/(?:workout|settings)(?:\/|$)/.test(pathname);
  // The tab screens' frosted header pads itself below the notch; other screens keep the padding.
  // A banner sits above that header, so on a tab screen the padding comes back while one shows.
  const tabRoot = TAB_ROOTS.includes(pathname);
  const session = useOpenSession(account);
  const bar = usePresence(docked ? session : null);
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
      className={`mx-auto flex min-h-dvh max-w-xl flex-col gap-6 ${
        tabRoot
          ? "has-[>[role=status]:not(.sr-only)]:pt-[max(1rem,env(safe-area-inset-top))]"
          : "pt-[max(1rem,env(safe-area-inset-top))]"
      } pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))] ${
        docked
          ? // The dock's height, its offset from the bottom edge and a gap above it; the toast
            // sits on the same line.
            `${
              bar.shown
                ? // The session bar, the gap to the tabs and the backing's top padding on top.
                  "[--chrome-bottom:calc(8.875rem+max(0.75rem,env(safe-area-inset-bottom)))]"
                : "[--chrome-bottom:calc(4.5rem+max(0.75rem,env(safe-area-inset-bottom)))]"
            } pb-[calc(var(--chrome-bottom)+0.5rem)]`
          : "pb-[max(1rem,env(safe-area-inset-bottom))]"
      }`}
    >
      {/* Mounted for good and filled when offline, so the change is announced. */}
      <p
        role="status"
        className={offline ? "animate-drop-in rounded-chip bg-track p-3 text-sm" : "sr-only"}
      >
        {offline ? t("offline") : ""}
      </p>
      <UpdateBanner />
      {/* Grows to the tab bar, so a screen can pin a line to its bottom (Settings' version). */}
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
      {docked && (
        <TabBar
          above={
            bar.shown && (
              <Suspense fallback={null}>
                <SessionBar
                  workout={bar.shown.workout}
                  sets={bar.shown.sets}
                  leaving={bar.leaving}
                  onAnimationEnd={bar.onAnimationEnd}
                />
              </Suspense>
            )
          }
        />
      )}
    </div>
  );
}
