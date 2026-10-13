import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axisOf, releaseOf, useSwipeToClose } from "./sheet-swipe";

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

// A card in the page, a hook watching it, and a finger moving on it.
function setup(enabled = true) {
  const card = document.createElement("div");
  document.body.append(card);
  const request = vi.fn();
  renderHook(() => useSwipeToClose({ current: card }, request, enabled));
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
  return { card, request, swipe };
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

  it("follows the finger and snaps back on a short slow swipe", () => {
    vi.useFakeTimers({ now: 0 });
    const { card, request } = setup();
    fireEvent.pointerDown(card, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 100 });
    vi.setSystemTime(300);
    fireEvent.pointerMove(card, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 140 });
    expect(card.style.transform).toBe("translateY(40px)");
    expect(card.style.transition).toBe("none");
    vi.setSystemTime(600);
    fireEvent.pointerUp(card, { pointerId: 1, isPrimary: true, clientX: 0, clientY: 140 });
    expect(request).not.toHaveBeenCalled();
    expect(card.style.transform).toBe("");
    expect(card.style.transition).toBe("var(--swipe-snap-transition)");
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
