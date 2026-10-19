import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHomeTrend, setHomeTrend } from "./home-trend";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("whether Home shows the trend", () => {
  it("shown by default", () => {
    expect(readHomeTrend()).toBe("shown");
    localStorage.setItem("belay.homeTrend", "neon");
    expect(readHomeTrend()).toBe("shown");
  });

  it("hidden once chosen", () => {
    setHomeTrend("hidden");
    expect(localStorage.getItem("belay.homeTrend")).toBe("hidden");
    expect(readHomeTrend()).toBe("hidden");
    setHomeTrend("shown");
    expect(readHomeTrend()).toBe("shown");
  });

  it("storage refused: shown, and a choice holds for the visit", () => {
    const refuse = () => {
      throw new DOMException("refused", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
    expect(readHomeTrend()).toBe("shown");
    setHomeTrend("hidden");
    expect(readHomeTrend()).toBe("hidden");
    setHomeTrend("shown");
    expect(readHomeTrend()).toBe("shown");
  });
});
