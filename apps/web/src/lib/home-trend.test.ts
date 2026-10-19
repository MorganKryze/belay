import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readHomeTrend, readRangePill, setHomeTrend, setRangePill } from "./home-trend";

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

describe("whether the trend shows its range pill", () => {
  it("shown by default", () => {
    expect(readRangePill()).toBe("shown");
    localStorage.setItem("belay.rangePill", "neon");
    expect(readRangePill()).toBe("shown");
  });

  it("hidden once chosen, under its own key", () => {
    setRangePill("hidden");
    expect(localStorage.getItem("belay.rangePill")).toBe("hidden");
    expect(readRangePill()).toBe("hidden");
    expect(readHomeTrend()).toBe("shown");
    expect(localStorage.getItem("belay.homeTrend")).toBeNull();
    setRangePill("shown");
    expect(readRangePill()).toBe("shown");
  });

  it("storage refused: shown, and a choice holds for the visit", () => {
    const refuse = () => {
      throw new DOMException("refused", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
    expect(readRangePill()).toBe("shown");
    setRangePill("hidden");
    expect(readRangePill()).toBe("hidden");
    expect(readHomeTrend()).toBe("shown");
    setRangePill("shown");
    expect(readRangePill()).toBe("shown");
  });
});
