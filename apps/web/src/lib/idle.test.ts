import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadWhenIdle } from "./idle";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// A page already loaded drops its preload, as the router's lazy components do.
const pages = () => [{ preload: vi.fn() }, { preload: vi.fn() }, {}];

describe("preloadWhenIdle", () => {
  it("waits for the browser's idle callback, with a deadline", () => {
    const requestIdleCallback = vi.fn<(run: () => void, options?: { timeout: number }) => number>();
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    const [a, b, loaded] = pages();
    preloadWhenIdle([a!, b!, loaded!]);
    expect(a!.preload).not.toHaveBeenCalled();
    const [callback, options] = requestIdleCallback.mock.calls[0]!;
    expect(options?.timeout).toBeGreaterThan(0);
    callback();
    expect(a!.preload).toHaveBeenCalledOnce();
    expect(b!.preload).toHaveBeenCalledOnce();
  });

  it("falls back to a timer where there is no idle callback", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    const [a] = pages();
    preloadWhenIdle([a!]);
    expect(a!.preload).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(a!.preload).toHaveBeenCalledOnce();
  });
});
