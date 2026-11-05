import type { AnyRouter } from "@tanstack/react-router";
import { noteEntry, previousHref } from "@/lib/back";
import { isNative } from "@/lib/platform";
import { tabIndexOf } from "@/lib/tab-index";
import { levelOf } from "@/lib/transitions";

// The page and scroll each tab was left on, for this page load only: addresses hold ids, so
// nothing is written down, and sign-out and sign-in both load the page again, which forgets them.
// `under` is the tab's root as the page was opened from it (Séances on its Exercices segment), so
// the root put back under it in the apps is the one its chevron names.
const kept = new Map<number, { href: string; y: number; under?: string }>();
// The page the bar just brought back, while it is on screen, so a not-found or error screen there
// knows memory led to it.
let restored: { href: string; tab: number; root: string } | undefined;

// How long a restored scroll waits for the page to grow tall enough as its data arrives. Past it
// the page stays where it could get.
const SCROLL_WAIT_MS = 1000;

const pathOf = (href: string) => href.replace(/[?#].*/, "");

// Once that page has rendered: the page left may still be finishing its own. A page still too
// short is tried again each time `main` grows. Returns how to give up.
function restoreScroll(router: AnyRouter, href: string, y: number) {
  const off = router.subscribe("onRendered", ({ toLocation }) => {
    if (toLocation.href !== href) return;
    off();
    const reach = () => {
      window.scrollTo(0, y);
      return Math.abs(window.scrollY - y) < 1;
    };
    const main = document.querySelector("main");
    if (reach() || !main) return;
    const stop = () => {
      watch.disconnect();
      clearTimeout(timer);
    };
    const watch = new ResizeObserver(() => reach() && stop());
    const timer = setTimeout(stop, SCROLL_WAIT_MS);
    watch.observe(main);
  });
  return off;
}

// A tab from the bar: the page it was left on, where it was left, in place of the page on screen,
// so a switch adds no Back step. From a page in no tab (Réglages on a computer) it is a new entry.
// The active tab goes to its root, or to the top from there.
export function goToTab(router: AnyRouter, tab: 0 | 1 | 2 | 3, root: string): void {
  const { href, pathname, search } = router.state.location;
  const from = tabIndexOf(pathname, search as { from?: unknown });
  restored = undefined;
  // The tab's root this page was opened from, as it was then (Séances on its Exercices segment).
  const before = previousHref(router.history);
  const under =
    before && levelOf(pathOf(before)) === 0 && tabIndexOf(pathOf(before)) === from
      ? before
      : undefined;
  if (from === tab) {
    kept.delete(tab);
    if (levelOf(pathname) === 0) {
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    } else if (under) router.history.back();
    else void router.navigate({ href: root, replace: true, viewTransition: false });
    return;
  }
  if (from !== null) kept.set(from, { href, y: window.scrollY, under });
  const page = kept.get(tab);
  if (page) {
    const mine = { href: page.href, tab, root };
    restored = mine;
    // Forgotten as soon as the person moves on: a page they reach later by other means keeps its
    // own not-found screen.
    const giveUp = restoreScroll(router, page.href, page.y);
    const off = router.subscribe("onBeforeNavigate", ({ toLocation }) => {
      if (toLocation.href === page.href) return;
      off();
      giveUp();
      if (restored === mine) restored = undefined;
    });
  }
  const to = page?.href ?? root;
  // The scroll is the restored one, set once the page is drawn, not the router's reset to the top.
  const options = { href: to, viewTransition: false, resetScroll: !page } as const;
  if (from === null) void router.navigate(options);
  else if (isNative() && levelOf(pathOf(to)) !== 0) {
    // The tab's root takes the place of the page left, under the router, then the page goes on
    // top: Back, the chevron and the swipe all reach the root in one step. The router's own
    // replace and push in one go would be merged into a single entry.
    const base = page?.under ?? root;
    const index = router.history.location.state.__TSR_index;
    window.history.replaceState({ ...window.history.state }, "", base);
    noteEntry(router.history, index, base);
    void router.navigate(options);
  } else void router.navigate({ ...options, replace: true });
}

// A remembered page that no longer exists or failed to load gives way to its tab's root, and is
// forgotten. Any other missing page keeps its own screen.
export function leaveMissing(router: AnyRouter): void {
  if (restored?.href !== router.state.location.href) return;
  const { tab, root } = restored;
  restored = undefined;
  kept.delete(tab);
  void router.navigate({ href: root, replace: true, viewTransition: false });
}
