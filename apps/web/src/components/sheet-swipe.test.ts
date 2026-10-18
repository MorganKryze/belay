import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axisOf, releaseOf, useSwipeToClose, veilColor, veilOpacity } from "./sheet-swipe";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("axisOf", () => {
  it.each([
    [0, 7, null],
    [7, 0, null],
    [5, 5, null],
    [3, 12, "vertical"],
    [0, -9, "vertical"],
    [12, 10, "horizontal"],
    [-20, 4, "horizontal"],
  ] as const)("reads %d px across and %d px down as %s", (dx, dy, axis) => {
    expect(axisOf(dx, dy)).toBe(axis);
  });
});

describe("releaseOf", () => {
  it.each([
    [91, 0, "close"],
    [40, 0.7, "close"],
    [40, 0.3, "snap"],
    [90, 0.6, "snap"],
    [-40, 0.7, "snap"],
  ] as const)("lets go at %d px and %d px/ms as %s", (dy, velocity, release) => {
    expect(releaseOf(dy, velocity)).toBe(release);
  });
});

describe("veilOpacity", () => {
  it("the veil lightens with the distance pulled and never goes below 0", () => {
    expect(veilOpacity(0, 400)).toBe(1);
    expect(veilOpacity(100, 400)).toBe(0.75);
    expect(veilOpacity(500, 400)).toBe(0);
    expect(veilOpacity(10, 0)).toBe(1);
  });
});

describe("veilColor", () => {
  it("the veil's colour follows the distance pulled", () => {
    expect(veilColor(0.75)).toBe("color-mix(in srgb, var(--scrim) 75%, transparent)");
    expect(veilColor(0.704)).toBe("color-mix(in srgb, var(--scrim) 70%, transparent)");
    expect(veilColor(0)).toBe("color-mix(in srgb, var(--scrim) 0%, transparent)");
  });
});

// A 400 px card in the page with its veil, a hook watching it, and a finger moving on it.
function setup(enabled = true) {
  const card = document.createElement("div");
  Object.defineProperty(card, "offsetHeight", { value: 400 });
  const veil = document.createElement("div");
  document.body.append(veil, card);
  const request = vi.fn();
  renderHook(() => useSwipeToClose({ current: card }, request, enabled, { current: veil }));
  let t = 0;
  const at = (y: number) => ({ pointerId: 1, isPrimary: true, clientX: 100, clientY: y });
  const swipe = (to: number, steps = 6) => {
    fireEvent.pointerDown(card, at(100));
    for (let i = 1; i <= steps; i++) {
      t += 50;
      vi.setSystemTime(t);
      fireEvent.pointerMove(card, at(100 + (to * i) / steps));
    }
    fireEvent.pointerUp(card, at(100 + to));
  };
  return { card, veil, request, swipe };
}

describe("useSwipeToClose", () => {
  afterEach(() => vi.useRealTimers());

  it("the hook closes once past 90 px", () => {
    vi.useFakeTimers({ now: 0 });
    const { card, request, swipe } = setup();
    swipe(120);
    expect(request).toHaveBeenCalledTimes(1);
    expect(card.style.getPropertyValue("--swipe-y")).toBe("120px");
  });

  it("lightens the veil as the card goes down, and the exit fades it from there", () => {
    vi.useFakeTimers({ now: 0 });
    const { veil, request, swipe } = setup();
    swipe(120);
    expect(request).toHaveBeenCalledTimes(1);
    expect(veil.style.backgroundColor).toBe("color-mix(in srgb, var(--scrim) 70%, transparent)");
  });

  it("the drag never sets the veil's opacity", () => {
    vi.useFakeTimers({ now: 0 });
    const { veil, swipe } = setup();
    swipe(60);
    expect(veil.style.opacity).toBe("");
    expect(veil.getAttribute("style")).not.toMatch(/opacity/);
  });

  it("follows the finger and snaps back on a short slow swipe", () => {
    vi.useFakeTimers({ now: 0 });
    const { card, veil, request } = setup();
    fireEvent.pointerDown(card, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 100 });
    vi.setSystemTime(300);
    fireEvent.pointerMove(card, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 140 });
    expect(card.style.transform).toBe("translateY(40px)");
    expect(card.style.transition).toBe("none");
    expect(veil.style.backgroundColor).toBe("color-mix(in srgb, var(--scrim) 90%, transparent)");
    expect(veil.style.opacity).toBe("");
    expect(veil.style.transition).toBe("none");
    vi.setSystemTime(600);
    fireEvent.pointerUp(card, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 140 });
    expect(request).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
    expect(card.style.transition).toBe("var(--swipe-snap-transition)");
    expect(card.style.opacity).toBe("");
    expect(veil.style.backgroundColor).toBe("");
    expect(veil.style.opacity).toBe("");
    expect(veil.style.transition).toBe("background-color var(--dur-release) var(--ease-out)");
  });

  it("closes on a flick short of 90 px", () => {
    vi.useFakeTimers({ now: 0 });
    const { request, swipe } = setup();
    swipe(40, 1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("ignores a swipe while the content is scrolled", () => {
    vi.useFakeTimers({ now: 0 });
    const { card, request, swipe } = setup();
    card.scrollTop = 30;
    swipe(200);
    expect(request).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
  });

  it("ignores a sideways swipe", () => {
    const { card, request } = setup();
    fireEvent.pointerDown(card, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(card, { pointerId: 1, isPrimary: true, clientX: 30, clientY: 10 });
    fireEvent.pointerMove(card, { pointerId: 1, isPrimary: true, clientX: 40, clientY: 150 });
    fireEvent.pointerUp(card, { pointerId: 1, isPrimary: true, clientX: 40, clientY: 150 });
    expect(request).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
  });

  it("ignores it when disabled", () => {
    vi.useFakeTimers({ now: 0 });
    const { card, request, swipe } = setup(false);
    swipe(200);
    expect(request).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
  });
});
