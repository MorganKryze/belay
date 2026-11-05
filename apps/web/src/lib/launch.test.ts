import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as launchModule from "./launch";
import { holdLaunch, LAUNCH_SAFETY_MS } from "./launch";

describe("holdLaunch", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "performance",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("with the account known, leaves once two frames are painted and holds nothing more", () => {
    const launch = vi.fn();
    holdLaunch(true, launch, performance.now());
    vi.advanceTimersByTime(16);
    expect(launch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(launch).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(LAUNCH_SAFETY_MS);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("with the account unknown, waits for the safety delay and no longer", () => {
    const launch = vi.fn();
    holdLaunch(false, launch, performance.now());
    vi.advanceTimersByTime(LAUNCH_SAFETY_MS - 1);
    expect(launch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("the safety delay counts from the start, not from the call", () => {
    const launch = vi.fn();
    const start = performance.now();
    vi.advanceTimersByTime(LAUNCH_SAFETY_MS - 10);
    holdLaunch(false, launch, start);
    vi.advanceTimersByTime(10);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("stopping clears the frames and the safety delay", () => {
    const launch = vi.fn();
    const stop = holdLaunch(true, launch, performance.now());
    stop();
    vi.advanceTimersByTime(LAUNCH_SAFETY_MS);
    expect(launch).not.toHaveBeenCalled();
  });

  it("keeps no minimum time for the mark", () => {
    expect(launchModule).not.toHaveProperty("launchHoldLeft");
    expect(launchModule).not.toHaveProperty("LAUNCH_HOLD_MS");
  });
});
