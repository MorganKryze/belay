import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readHistoryActivities,
  readSessionVolume,
  setHistoryActivities,
  setSessionVolume,
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
