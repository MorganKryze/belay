import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Every ResizeObserver the module makes, with what it watches, so a test can say "this resized".
class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  watched = new Set<Element>();
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.made.push(this);
  }
  observe(target: Element) {
    this.watched.add(target);
  }
  unobserve(target: Element) {
    this.watched.delete(target);
  }
  disconnect() {
    this.watched.clear();
  }
  static resize(target: Element) {
    for (const o of FakeResizeObserver.made)
      if (o.watched.has(target)) o.callback([], o as unknown as ResizeObserver);
  }
}

const root = document.documentElement;
const scale = () => root.style.getPropertyValue("--text-scale");
const dockExtra = () => root.style.getPropertyValue("--dock-extra");

// The iPhone's web view knows the system's body style; Android's does not.
function onIPhone(iPhone: boolean) {
  vi.stubGlobal("CSS", {
    supports: (_: string, value: string) => iPhone && value === "-apple-system-body",
  });
}

// A dock whose labels grow with the text: 64 px tall at the default size, 30 px more otherwise.
function dock() {
  const el = document.createElement("div");
  el.setAttribute("data-dock", "");
  el.getBoundingClientRect = () => ({ height: Number(scale() || 1) === 1 ? 64 : 94 }) as DOMRect;
  document.body.append(el);
  return el;
}

const probe = () => document.querySelector<HTMLElement>("[data-text-probe]")!;
const flush = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(() => {
  vi.resetModules();
  FakeResizeObserver.made = [];
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  root.removeAttribute("style");
  root.removeAttribute("data-text-scaled");
  root.removeAttribute("data-contrast");
});

describe("readRatio", () => {
  it("reads the system's body size over its default 17 px", async () => {
    const { BODY_PX, readRatio } = await import("./text-scale");
    expect(BODY_PX).toBe(17);
    expect(readRatio(40)).toBeCloseTo(2.35, 2);
    expect(readRatio(17)).toBe(1);
  });

  it("is silent on anything but a size", async () => {
    const { readRatio } = await import("./text-scale");
    for (const bad of [NaN, Infinity, 0, -17]) expect(readRatio(bad)).toBeNull();
  });
});

describe("watchTextScale", () => {
  it("on the iPhone, follows a change of the system's text size made while the app is open", async () => {
    onIPhone(true);
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    expect(probe().getAttribute("aria-hidden")).toBe("true");

    probe().style.fontSize = "40px";
    FakeResizeObserver.resize(probe());
    expect(Number(scale())).toBeCloseTo(2.35, 2);
  });

  it("on Android, reads nothing more: the shell's ratio holds until the app restarts", async () => {
    onIPhone(false);
    root.style.setProperty("--text-scale", "2");
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    expect(probe()).toBeNull();
    expect(scale()).toBe("2");
  });

  it("adds what the dock grows by to the room the page keeps for it", async () => {
    onIPhone(false);
    root.style.setProperty("--text-scale", "2");
    const bar = dock();
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    FakeResizeObserver.resize(bar);
    expect(dockExtra()).toBe("30px");
    expect(scale()).toBe("2");
  });

  it("finds a dock that comes back after a page without one", async () => {
    onIPhone(false);
    root.style.setProperty("--text-scale", "2");
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    const bar = dock();
    await flush();
    FakeResizeObserver.resize(bar);
    expect(dockExtra()).toBe("30px");
  });

  it("at the default text size watches nothing and adds nothing", async () => {
    onIPhone(false);
    dock();
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    expect(FakeResizeObserver.made).toEqual([]);
    expect(dockExtra()).toBe("0px");
  });

  it("back at the default size on the iPhone, stops watching the dock and adds nothing", async () => {
    onIPhone(true);
    const bar = dock();
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    probe().style.fontSize = "40px";
    FakeResizeObserver.resize(probe());
    FakeResizeObserver.resize(bar);
    expect(dockExtra()).toBe("30px");

    probe().style.fontSize = "17px";
    FakeResizeObserver.resize(probe());
    expect(scale()).toBe("1");
    expect(dockExtra()).toBe("0px");
    expect(FakeResizeObserver.made.some((o) => o.watched.has(bar))).toBe(false);
  });

  it("marks the page while the text is enlarged, so what wraps only then can follow", async () => {
    onIPhone(true);
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    expect(root.hasAttribute("data-text-scaled")).toBe(false);

    probe().style.fontSize = "40px";
    FakeResizeObserver.resize(probe());
    expect(root.hasAttribute("data-text-scaled")).toBe(true);

    probe().style.fontSize = "17px";
    FakeResizeObserver.resize(probe());
    expect(root.hasAttribute("data-text-scaled")).toBe(false);
  });

  it("measures the dock's default height without what wraps only at enlarged text", async () => {
    onIPhone(false);
    root.style.setProperty("--text-scale", "2");
    const bar = dock();
    // A long exercise name in the session bar takes a second line once wrapping is on.
    bar.getBoundingClientRect = () =>
      ({
        height:
          (Number(scale() || 1) === 1 ? 64 : 94) + (root.hasAttribute("data-text-scaled") ? 26 : 0),
      }) as DOMRect;
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    FakeResizeObserver.resize(bar);
    expect(dockExtra()).toBe("56px");
    expect(root.hasAttribute("data-text-scaled")).toBe(true);
  });
});

describe("the contrast the Android app reports", () => {
  // The shell's answer, as a change in the phone's Settings leaves it; the page is in the
  // background until `visible`.
  let more = false;
  const comeBack = (state: DocumentVisibilityState) => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
    document.dispatchEvent(new Event("visibilitychange"));
  };
  beforeEach(() => {
    onIPhone(false);
    vi.stubGlobal("BelayText", { scale: () => 1, contrast: () => more });
  });
  afterEach(() => vi.restoreAllMocks());

  it("is read again when the app comes back to the foreground", async () => {
    more = false;
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    more = true;
    comeBack("hidden");
    expect(root.dataset.contrast).toBeUndefined();
    comeBack("visible");
    expect(root.dataset.contrast).toBe("more");
    more = false;
    comeBack("visible");
    expect(root.dataset.contrast).toBeUndefined();
  });

  it("is left alone where the shell reports none", async () => {
    vi.stubGlobal("BelayText", { scale: () => 1 });
    const { watchTextScale } = await import("./text-scale");
    watchTextScale();
    comeBack("visible");
    expect(root.dataset.contrast).toBeUndefined();
  });
});
