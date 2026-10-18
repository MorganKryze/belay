import { beforeEach, describe, expect, it } from "vitest";
import { readPauseStops, setPauseStops } from "./pause-stops";

beforeEach(() => localStorage.clear());

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
});
