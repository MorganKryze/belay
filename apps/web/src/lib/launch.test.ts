import { describe, expect, it } from "vitest";
import { launchHoldLeft } from "./launch";

describe("launchHoldLeft", () => {
  it("holds the rest of the second after the first paint", () => {
    expect(launchHoldLeft(400, 150)).toBe(750);
  });

  it("nothing left once the second has passed", () => {
    expect(launchHoldLeft(1500, 150)).toBe(0);
  });

  it("a launch screen not painted yet waits the whole second", () => {
    expect(launchHoldLeft(900, undefined)).toBe(1000);
  });
});
