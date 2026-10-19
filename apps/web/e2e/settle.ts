import { expect, type Locator, type Page, type Request } from "@playwright/test";

// Waits until the page transition in flight has finished. Its animations start a frame after the
// new page is drawn, so counting them can find none too early; the document's active transition
// is set from the DOM update until the transition ends. While it runs, its overlay takes taps and
// the router has not settled the new page's scroll yet.
export async function settled(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(
        () => (document as { activeViewTransition?: ViewTransition | null }).activeViewTransition,
      ),
    )
    .toBeNull();
}

// Hovers a link and waits until the page it opens has loaded ahead (the router preloads on
// intent). A page whose code is late shows the pending mark in place of the page left, which
// drops its scroll before the transition captures it.
export async function preloaded(page: Page, link: Locator): Promise<void> {
  // Only the requests the hover starts: one already in flight may finish here or never.
  const inflight = new Set<Request>();
  let last = Date.now();
  const started = (request: Request) => {
    inflight.add(request);
    last = Date.now();
  };
  const ended = (request: Request) => {
    inflight.delete(request);
  };
  page.on("request", started);
  page.on("requestfinished", ended);
  page.on("requestfailed", ended);
  try {
    await link.hover();
    // Quiet for longer than the router's 50 ms intent delay, nothing in flight.
    await expect.poll(() => inflight.size === 0 && Date.now() - last > 200).toBe(true);
  } finally {
    page.off("request", started);
    page.off("requestfinished", ended);
    page.off("requestfailed", ended);
  }
}
