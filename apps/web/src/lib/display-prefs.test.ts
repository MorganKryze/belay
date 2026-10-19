import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readHistoryActivities,
  readSessionVolume,
  readWeekIntake,
  setHistoryActivities,
  setSessionVolume,
  setWeekIntake,
} from "./display-prefs";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("what the history and a session show", () => {
  it("shown by default, and an unknown value reads as shown", () => {
    expect(readHistoryActivities()).toBe("shown");
    expect(readSessionVolume()).toBe("shown");
    localStorage.setItem("belay.historyActivities", "neon");
    localStorage.setItem("belay.sessionVolume", "neon");
    expect(readHistoryActivities()).toBe("shown");
    expect(readSessionVolume()).toBe("shown");
  });

  it("each choice is kept under its own key, apart from the other", () => {
    setHistoryActivities("hidden");
    expect(localStorage.getItem("belay.historyActivities")).toBe("hidden");
    expect(readHistoryActivities()).toBe("hidden");
    expect(readSessionVolume()).toBe("shown");
    setSessionVolume("hidden");
    setHistoryActivities("shown");
    expect(localStorage.getItem("belay.sessionVolume")).toBe("hidden");
    expect(readSessionVolume()).toBe("hidden");
    expect(readHistoryActivities()).toBe("shown");
    // The in-memory fallback outlives the test: leave it as it started.
    setSessionVolume("shown");
  });

  it("storage refused: shown, and each choice holds for the visit on its own", () => {
    const refuse = () => {
      throw new DOMException("refused", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
    expect(readHistoryActivities()).toBe("shown");
    expect(readSessionVolume()).toBe("shown");
    setHistoryActivities("hidden");
    expect(readHistoryActivities()).toBe("hidden");
    expect(readSessionVolume()).toBe("shown");
    setSessionVolume("hidden");
    setHistoryActivities("shown");
    expect(readSessionVolume()).toBe("hidden");
    expect(readHistoryActivities()).toBe("shown");
    setSessionVolume("shown");
  });
});

describe("whether Corps shows the weekly intake", () => {
  it("shown by default, and an unknown value reads as shown", () => {
    expect(readWeekIntake()).toBe("shown");
    localStorage.setItem("belay.weekIntake", "neon");
    expect(readWeekIntake()).toBe("shown");
  });

  it("hidden once chosen, under its own key", () => {
    setWeekIntake("hidden");
    expect(localStorage.getItem("belay.weekIntake")).toBe("hidden");
    expect(readWeekIntake()).toBe("hidden");
    expect(readSessionVolume()).toBe("shown");
    expect(readHistoryActivities()).toBe("shown");
    setWeekIntake("shown");
    expect(readWeekIntake()).toBe("shown");
  });

  it("storage refused: shown, and a choice holds for the visit", () => {
    const refuse = () => {
      throw new DOMException("refused", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
    expect(readWeekIntake()).toBe("shown");
    setWeekIntake("hidden");
    expect(readWeekIntake()).toBe("hidden");
    expect(readSessionVolume()).toBe("shown");
    setWeekIntake("shown");
    expect(readWeekIntake()).toBe("shown");
  });
});
