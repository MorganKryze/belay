import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scheduleUpdateChecks } from "./update";

const hour = 60 * 60 * 1000;
let online = true;
let stop: () => void;
const update = vi.fn(() => Promise.resolve());

beforeEach(() => {
  vi.useFakeTimers();
  online = true;
  update.mockReset();
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  stop = scheduleUpdateChecks({ update } as unknown as ServiceWorkerRegistration);
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const show = (state: DocumentVisibilityState) => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(state);
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("scheduleUpdateChecks", () => {
  it("checks every hour", () => {
    vi.advanceTimersByTime(hour);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2 * hour);
    expect(update).toHaveBeenCalledTimes(3);
  });

  it("checks when the app comes back to the foreground, not when it leaves", () => {
    show("hidden");
    expect(update).not.toHaveBeenCalled();
    show("visible");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("does not check while offline", () => {
    online = false;
    show("visible");
    vi.advanceTimersByTime(hour);
    expect(update).not.toHaveBeenCalled();
  });

  it("stops checking once stopped", () => {
    stop();
    show("visible");
    vi.advanceTimersByTime(hour);
    expect(update).not.toHaveBeenCalled();
  });
});
