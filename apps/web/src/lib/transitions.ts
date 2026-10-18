// How a page change moves: deeper pages slide in from the right (push) and back out (pop), the
// session and its summary rise from the bottom (cover) and sink back (uncover). Tab to tab and
// page to page at the same depth change in the same frame, with no page animation.
export type NavKind = "push" | "pop" | "cover" | "uncover";

const TABS = new Set(["/", "/workouts", "/body", "/tools"]);
const COVER = /^\/workout(?:\/edit|\/summary\/[^/]+)?$/;
const SUMMARY = /^\/workout\/summary\/[^/]+\/?$/;
const DEEP = new Set(["/settings/profile", "/settings/supplements", "/tools/plates/equipment"]);

// The depth of a page, from the route table. Anything not listed (a detail page, a tool, an
// unknown path) sits one level under the tabs.
export function levelOf(pathname: string): 0 | 1 | 2 | "cover" {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (TABS.has(path)) return 0;
  if (COVER.test(path)) return "cover";
  if (DEEP.has(path)) return 2;
  return 1;
}

export function navKind(
  from: string | undefined,
  to: string,
  swipedBack: boolean,
): NavKind | false {
  // The browser already animated its own back swipe; a second slide on top would play twice.
  if (from === undefined || from === to || swipedBack) return false;
  const a = levelOf(from);
  const b = levelOf(to);
  // A session's summary rises over it as a cover of its own; other covers swap in place.
  if (a === "cover")
    return b !== "cover" ? "uncover" : SUMMARY.test(to) && !SUMMARY.test(from) ? "cover" : false;
  if (b === "cover") return "cover";
  if (b > a) return "push";
  if (b < a) return "pop";
  return false;
}

// Set by the browser on a popstate it already animated (an iPhone edge swipe). The router reads
// the location after this event, so a capture listener installed before the router sees it first.
let uaTransition = false;
if (typeof window !== "undefined") {
  window.addEventListener(
    "popstate",
    (event) => {
      uaTransition =
        (event as PopStateEvent & { hasUAVisualTransition?: boolean }).hasUAVisualTransition ===
        true;
    },
    { capture: true },
  );
}

type LocationChange = {
  fromLocation?: { pathname: string };
  toLocation: { pathname: string };
  pathChanged: boolean;
};

// Only browsers that can scope the CSS to a transition type get one: an untyped transition would
// crossfade every tab switch. Elsewhere pages change at once, as before.
const typed =
  typeof CSS !== "undefined" && CSS.supports("selector(:active-view-transition-type(a))");

export const viewTransition: false | { types: (info: LocationChange) => NavKind[] | false } =
  typed && {
    types: ({ fromLocation, toLocation }) => {
      const swiped = uaTransition;
      uaTransition = false;
      const kind = navKind(fromLocation?.pathname, toLocation.pathname, swiped);
      return kind && [kind];
    },
  };
