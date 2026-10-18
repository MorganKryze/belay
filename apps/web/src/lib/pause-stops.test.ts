import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPauseStops, setPauseStops } from "./pause-stops";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("what a pause stops", () => {
  it("defaults to everything and ignores garbage in storage", () => {
    expect(readPauseStops()).toBe("all");
    localStorage.setItem("belay.pauseStops", "neon");
    expect(readPauseStops()).toBe("all");
  });

  it("keeps the choice on this device", () => {
    setPauseStops("session");
    expect(localStorage.getItem("belay.pauseStops")).toBe("session");
    expect(readPauseStops()).toBe("session");
    setPauseStops("all");
    expect(readPauseStops()).toBe("all");
  });

  it("keeps the choice for this visit when storage refuses it", () => {
    const refuse = () => {
      throw new DOMException("refused", "SecurityError");
    };
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(refuse);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(refuse);
    setPauseStops("session");
    expect(readPauseStops()).toBe("session");
    setPauseStops("all");
    expect(readPauseStops()).toBe("all");
  });
});
