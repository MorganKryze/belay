// Fetches lazy pages ahead of their first use, once the first screen has settled. Safari has no
// requestIdleCallback, so a short timer stands in there; the deadline keeps a busy page from
// putting the fetch off for good. A failed fetch waits for the page's first render to show.
export function preloadWhenIdle(pages: readonly { preload?: () => unknown }[]) {
  const run = () => pages.forEach((page) => page.preload?.());
  if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 2000 });
  else setTimeout(run, 300);
}
