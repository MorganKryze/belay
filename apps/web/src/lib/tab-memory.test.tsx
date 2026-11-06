import {
  createBrowserHistory,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type RouterHistory,
} from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The memory lives for the page's run, so each test loads it afresh.
let back: typeof import("./back");
let memory: typeof import("./tab-memory");
beforeEach(async () => {
  vi.resetModules();
  back = await import("./back");
  memory = await import("./tab-memory");
});

// Any address renders a page, so the tests follow the memory alone, not the app's screens.
function setup(history: RouterHistory) {
  const root = createRootRoute({
    component: () => (
      <main>
        <Outlet />
      </main>
    ),
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: "$",
    component: () => <h1>page</h1>,
  });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => <h1>/</h1> });
  const router = createRouter({ routeTree: root.addChildren([index, page]), history });
  back.trackEntries(router.history);
  render(<RouterProvider router={router} />);
  return router;
}
type Router = ReturnType<typeof setup>;

// jsdom does not scroll: the stand-in records where the page was sent and stays there.
let y = 0;
const scrolls: unknown[] = [];
beforeEach(() => {
  y = 0;
  scrolls.length = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => y);
  vi.stubGlobal("scrollTo", (a: number | ScrollToOptions, b?: number) => {
    scrolls.push(typeof a === "number" ? [a, b] : a);
    y = typeof a === "number" ? (b ?? 0) : (a.top ?? 0);
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const at = (router: Router) => router.state.location.href;
async function go(router: Router, href: string) {
  await act(() => router.navigate({ href }));
}
async function tab(router: Router, i: 0 | 1 | 2 | 3, root: string) {
  await act(async () => {
    memory.goToTab(router, i, root);
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("in a browser", () => {
  it("keeps the deep page and scroll a tab was left on, and brings both back in place of the page left", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/"] }));
    await go(router, "/workouts");
    await go(router, "/workouts/abc");
    y = 640;
    await tab(router, 3, "/tools");
    expect(at(router)).toBe("/tools");
    const length = router.history.length;
    await tab(router, 1, "/workouts");
    expect(at(router)).toBe("/workouts/abc");
    expect(scrolls.at(-1)).toEqual([0, 640]);
    expect(router.history.length).toBe(length);
  });

  it("a tab never left opens at its root, in place of the page left", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/"] }));
    const length = router.history.length;
    await tab(router, 2, "/body");
    expect(at(router)).toBe("/body");
    expect(router.history.length).toBe(length);
  });

  it("keeps a preview opened from Accueil under Accueil", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/"] }));
    await go(router, "/workouts/session/A?from=home");
    await tab(router, 1, "/workouts");
    expect(at(router)).toBe("/workouts");
    await tab(router, 0, "/");
    expect(at(router)).toBe("/workouts/session/A?from=home");
  });

  it.each(["/settings", "/workout"])("keeps nothing of %s, a page in no tab", async (path) => {
    const router = setup(createMemoryHistory({ initialEntries: ["/"] }));
    await go(router, path);
    await tab(router, 3, "/tools");
    for (const [i, root] of [
      [0, "/"],
      [1, "/workouts"],
      [2, "/body"],
    ] as const) {
      await tab(router, i, root);
      expect(at(router)).toBe(root);
    }
  });

  it("from a page in no tab a tab is a new entry", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/"] }));
    await go(router, "/settings");
    const length = router.history.length;
    await tab(router, 3, "/tools");
    expect(at(router)).toBe("/tools");
    expect(router.history.length).toBe(length + 1);
  });

  it("the active tab from a deep page goes to its root and forgets the page", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/tools"] }));
    await go(router, "/tools/bmi");
    await tab(router, 3, "/tools");
    await vi.waitFor(() => expect(at(router)).toBe("/tools"));
    await tab(router, 2, "/body");
    await tab(router, 3, "/tools");
    expect(at(router)).toBe("/tools");
  });

  it("the active tab on its root scrolls to the top, smoothly", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/tools"] }));
    y = 500;
    await tab(router, 3, "/tools");
    expect(at(router)).toBe("/tools");
    expect(scrolls).toContainEqual({ top: 0, behavior: "smooth" });
  });

  it("at once under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    const router = setup(createMemoryHistory({ initialEntries: ["/tools"] }));
    y = 500;
    await tab(router, 3, "/tools");
    expect(scrolls).toContainEqual({ top: 0, behavior: "auto" });
  });

  it("a remembered page gone missing leaves for the tab's root and is forgotten", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/workouts"] }));
    await go(router, "/workouts/gone");
    await tab(router, 2, "/body");
    await tab(router, 1, "/workouts");
    expect(at(router)).toBe("/workouts/gone");
    const length = router.history.length;
    await act(async () => memory.leaveMissing(router));
    await vi.waitFor(() => expect(at(router)).toBe("/workouts"));
    expect(router.history.length).toBe(length);
    await tab(router, 2, "/body");
    await tab(router, 1, "/workouts");
    expect(at(router)).toBe("/workouts");
  });

  it("a page missing that the bar did not bring back stays where it is", async () => {
    const router = setup(createMemoryHistory({ initialEntries: ["/workouts"] }));
    await go(router, "/workouts/gone");
    await act(async () => memory.leaveMissing(router));
    expect(at(router)).toBe("/workouts/gone");
  });
});

describe("in the app", () => {
  beforeEach(() => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    window.history.replaceState(null, "", "/");
  });

  it("a deep page comes back over its tab's root, so one step back shows the root", async () => {
    const router = setup(createBrowserHistory());
    await go(router, "/workouts");
    await go(router, "/workouts/abc");
    await tab(router, 2, "/body");
    expect(at(router)).toBe("/body");
    const length = window.history.length;
    await tab(router, 1, "/workouts");
    expect(window.location.pathname).toBe("/workouts/abc");
    expect(window.history.length).toBe(length + 1);
    expect(back.previousHref(router.history)).toBe("/workouts");
    await act(async () => {
      window.history.back();
      await new Promise((r) => window.addEventListener("popstate", r, { once: true }));
    });
    await vi.waitFor(() => expect(at(router)).toBe("/workouts"));
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("the root put back is the one the page was opened from, as its chevron names it", async () => {
    const router = setup(createBrowserHistory());
    await go(router, "/workouts?tab=exercises");
    await go(router, "/exercises/ds:0025");
    await tab(router, 2, "/body");
    expect(at(router)).toBe("/body");
    await tab(router, 1, "/workouts");
    expect(window.location.pathname).toBe("/exercises/ds:0025");
    expect(back.previousHref(router.history)).toBe("/workouts?tab=exercises");
  });

  it("a root comes back in place of the page left", async () => {
    const router = setup(createBrowserHistory());
    await go(router, "/workouts");
    await tab(router, 2, "/body");
    expect(at(router)).toBe("/body");
    const length = window.history.length;
    await tab(router, 1, "/workouts");
    expect(window.location.pathname).toBe("/workouts");
    expect(window.history.length).toBe(length);
  });
});
