import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setSwipeBack = vi.fn<(o: { enabled: boolean }) => Promise<void>>();
vi.mock("./plugin", () => ({ BelayNative: { setSwipeBack } }));

const { watchSwipeBack } = await import("./swipe-back");

// A router at `pathname` whose resolved navigations the test fires by hand.
function routerAt(pathname: string) {
  const listeners: (() => void)[] = [];
  return {
    state: { location: { pathname } },
    subscribe: vi.fn((_event: "onResolved", fn: () => void) => {
      listeners.push(fn);
      return () => {};
    }),
    go(to: string) {
      this.state.location.pathname = to;
      for (const fn of listeners) fn();
    },
  };
}

// A surface as Radix leaves it in the page: a role and its open or closing state.
function surface(role = "dialog") {
  const el = document.createElement("div");
  el.setAttribute("role", role);
  el.setAttribute("data-state", "open");
  document.body.append(el);
  return el;
}

// Lets the observer's records and the plugin's answers land.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const calls = () => setSwipeBack.mock.calls.map(([o]) => o.enabled);

// Each test's watcher stops with it, so the next test hears only its own.
const observers: MutationObserver[] = [];
class Tracked extends MutationObserver {
  constructor(callback: MutationCallback) {
    super(callback);
    observers.push(this);
  }
}
vi.stubGlobal("MutationObserver", Tracked);

// The page as the iPhone app runs it, unless a test says otherwise.
let platform = "ios";
vi.stubGlobal("Capacitor", { isNativePlatform: () => true, getPlatform: () => platform });

beforeEach(() => {
  platform = "ios";
  setSwipeBack.mockReset();
  setSwipeBack.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const o of observers.splice(0)) o.disconnect();
  document.body.replaceChildren();
});

describe("the iPhone's edge swipe", () => {
  it("turns on at a pushed page, the shell having started with it off", async () => {
    watchSwipeBack(routerAt("/settings/profile"));
    await settle();
    expect(calls()).toEqual([true]);
  });

  it.each(["/", "/tools", "/workouts/", "/workout"])("stays off at %s", async (path) => {
    watchSwipeBack(routerAt(path));
    await settle();
    expect(calls()).toEqual([]);
  });

  it("goes on and off with the navigation, one call per change and none without one", async () => {
    const router = routerAt("/");
    watchSwipeBack(router);
    router.go("/settings");
    router.go("/settings/profile");
    router.go("/tools");
    router.go("/body");
    router.go("/workout");
    await settle();
    expect(calls()).toEqual([true, false]);
  });

  it("goes off while a sheet opens over a page and on again once it is gone", async () => {
    watchSwipeBack(routerAt("/settings/profile"));
    await settle();
    const sheet = surface();
    await settle();
    expect(calls()).toEqual([true, false]);
    sheet.setAttribute("data-state", "closed");
    await settle();
    expect(calls()).toEqual([true, false]);
    sheet.remove();
    await settle();
    expect(calls()).toEqual([true, false, true]);
  });

  it("a menu over a tab root sends nothing: the swipe is already off", async () => {
    watchSwipeBack(routerAt("/tools"));
    surface("menu").remove();
    await settle();
    expect(calls()).toEqual([]);
  });

  it("on Android sends nothing, its Back asking the page by its own path", async () => {
    platform = "android";
    const router = routerAt("/settings/profile");
    watchSwipeBack(router);
    surface().remove();
    router.go("/settings");
    await settle();
    expect(calls()).toEqual([]);
    expect(router.subscribe).not.toHaveBeenCalled();
  });

  it("a refused call leaves the swipe where the shell last put it", async () => {
    setSwipeBack.mockRejectedValueOnce(new Error("no web view"));
    const router = routerAt("/");
    watchSwipeBack(router);
    router.go("/settings");
    await settle();
    // Still off on the shell's side: back on a tab root, there is nothing to turn off.
    router.go("/tools");
    await settle();
    expect(calls()).toEqual([true]);
    // And the next page asks again.
    router.go("/tools/plates");
    await settle();
    expect(calls()).toEqual([true, true]);
  });
});
