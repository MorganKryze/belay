import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readBrzycki,
  readFieldSources,
  readHistoryActivities,
  readSessionVolume,
  readWeekIntake,
  setBrzycki,
  setFieldSources,
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

describe("what Outils shows: the second 1RM formula and where a field's value comes from", () => {
  it("both shown by default, and an unknown value reads as shown", () => {
    expect(readBrzycki()).toBe("shown");
    expect(readFieldSources()).toBe("shown");
    localStorage.setItem("belay.oneRepMaxBrzycki", "neon");
    localStorage.setItem("belay.fieldSources", "neon");
    expect(readBrzycki()).toBe("shown");
    expect(readFieldSources()).toBe("shown");
  });

  it("each hidden once chosen, under its own key", () => {
    setBrzycki("hidden");
    expect(localStorage.getItem("belay.oneRepMaxBrzycki")).toBe("hidden");
    expect(readBrzycki()).toBe("hidden");
    expect(readFieldSources()).toBe("shown");
    expect(readWeekIntake()).toBe("shown");
    setFieldSources("hidden");
    setBrzycki("shown");
    expect(localStorage.getItem("belay.fieldSources")).toBe("hidden");
    expect(readFieldSources()).toBe("hidden");
    expect(readBrzycki()).toBe("shown");
    setFieldSources("shown");
  });

  it("storage refused: shown, and each choice holds for the visit on its own", () => {
    const refuse = () => {
      throw new DOMException("refused", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
    expect(readBrzycki()).toBe("shown");
    expect(readFieldSources()).toBe("shown");
    setBrzycki("hidden");
    expect(readBrzycki()).toBe("hidden");
    expect(readFieldSources()).toBe("shown");
    setFieldSources("hidden");
    setBrzycki("shown");
    expect(readFieldSources()).toBe("hidden");
    expect(readBrzycki()).toBe("shown");
    setFieldSources("shown");
  });
});
