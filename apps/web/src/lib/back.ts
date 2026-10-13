import type { RouterHistory } from "@tanstack/react-router";

// The address of each entry of the tab's history, by its index, so a back link can tell whether
// the page before is the one it names. Only what this page load has seen is known: after a
// reload the entries before are blank and a back link opens its page as a new entry.
const seen = new WeakMap<RouterHistory, string[]>();

export function trackEntries(history: RouterHistory) {
  const hrefs: string[] = [];
  seen.set(history, hrefs);
  const note = () => {
    hrefs[history.location.state.__TSR_index] = history.location.href;
  };
  note();
  history.subscribe(note);
}

export function previousHref(history: RouterHistory): string | undefined {
  const index = history.location.state.__TSR_index;
  return index > 0 ? seen.get(history)?.[index - 1] : undefined;
}
