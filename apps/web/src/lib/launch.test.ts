import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdLaunch, LAUNCH_SAFETY_MS, launchHoldLeft } from "./launch";

describe("launchHoldLeft", () => {
  it("holds the rest of the second after the first paint", () => {
    expect(launchHoldLeft(400, 150)).toBe(750);
  });

  it("nothing left once the second has passed", () => {
    expect(launchHoldLeft(1500, 150)).toBe(0);
  });
});

it("rounds the time left up, so a timer firing a fraction early still holds a full second", () => {
  expect(launchHoldLeft(1000.4, 100)).toBe(100);
});

describe("holdLaunch", () => {
  // A paint observer the test feeds by hand, standing in for the browser's.
  let observers: { emit: (startTime: number) => void; disconnected: boolean }[];
  let painted: number | undefined;

  function observePaint() {
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        static supportedEntryTypes = ["paint"];
        disconnected = false;
        constructor(callback: (list: { getEntriesByName: (n: string) => unknown[] }) => void) {
          observers.push(this);
          this.emit = (startTime) =>
            this.disconnected ||
            callback({
              getEntriesByName: (n) => (n === "first-contentful-paint" ? [{ startTime }] : []),
            });
        }
        emit: (startTime: number) => void;
        observe() {}
        disconnect() {
          this.disconnected = true;
        }
      },
    );
  }

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
    observers = [];
    painted = undefined;
    vi.spyOn(performance, "getEntriesByName").mockImplementation((name) =>
      name === "first-contentful-paint" && painted !== undefined
        ? [{ startTime: painted } as PerformanceEntry]
        : [],
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("with the account known before the first paint, holds a full second from the paint", () => {
    observePaint();
    const launch = vi.fn();
    const start = performance.now();
    const loading = holdLaunch(false, launch, start);
    vi.advanceTimersByTime(988);
    loading();
    holdLaunch(true, launch, start);
    vi.advanceTimersByTime(704);
    expect(launch).not.toHaveBeenCalled();
    observers.at(-1)!.emit(performance.now());
    vi.advanceTimersByTime(999);
    expect(launch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("with the paint already done, holds the rest of its second", () => {
    observePaint();
    painted = 100;
    const launch = vi.fn();
    vi.advanceTimersByTime(400);
    holdLaunch(true, launch, 0);
    vi.advanceTimersByTime(699);
    expect(launch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("a paint that never comes still lets the screen go at the safety delay from the start", () => {
    observePaint();
    const launch = vi.fn();
    holdLaunch(true, launch, performance.now());
    vi.advanceTimersByTime(LAUNCH_SAFETY_MS - 1);
    expect(launch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(launch).toHaveBeenCalled();
  });

  it("an account that never answers lets the screen go at the safety delay", () => {
    observePaint();
    const launch = vi.fn();
    holdLaunch(false, launch, performance.now());
    vi.advanceTimersByTime(LAUNCH_SAFETY_MS);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("without paint entries, starts the hold two frames after the account", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const launch = vi.fn();
    holdLaunch(true, launch, performance.now());
    vi.advanceTimersByTime(32);
    expect(launch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(launch).toHaveBeenCalledOnce();
  });

  it("stopping clears the hold and the paint watch", () => {
    observePaint();
    const launch = vi.fn();
    const stop = holdLaunch(true, launch, performance.now());
    stop();
    expect(observers[0]!.disconnected).toBe(true);
    observers[0]!.emit(10);
    vi.advanceTimersByTime(LAUNCH_SAFETY_MS);
    expect(launch).not.toHaveBeenCalled();
  });
});
