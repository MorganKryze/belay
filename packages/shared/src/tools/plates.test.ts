import { describe, expect, it } from "vitest";
import { iwfColor, loadBar, nearestLoading, PLATE_PRESETS } from "./plates";

const gym = PLATE_PRESETS.gym.platesKg;
const competition = PLATE_PRESETS.competition.platesKg;

describe("loadBar", () => {
  it("loads an exact target with the fewest plates, heaviest first", () => {
    expect(loadBar(100, 20, gym)).toEqual({
      kind: "exact",
      loading: { totalKg: 100, perSideKg: [20, 20] },
    });
    expect(loadBar(90, 20, gym)).toEqual({
      kind: "exact",
      loading: { totalKg: 90, perSideKg: [20, 10, 5] },
    });
    expect(loadBar(100, 20, competition)).toEqual({
      kind: "exact",
      loading: { totalKg: 100, perSideKg: [25, 15] },
    });
  });

  it("uses the gym preset's 2.5 kg plate for the last step", () => {
    expect(loadBar(75, 20, gym)).toEqual({
      kind: "exact",
      loading: { totalKg: 75, perSideKg: [20, 5, 2.5] },
    });
  });

  it("returns the bar alone when the target is the bar", () => {
    expect(loadBar(20, 20, gym)).toEqual({
      kind: "exact",
      loading: { totalKg: 20, perSideKg: [] },
    });
  });

  it("offers the reachable loads just below and just above an unreachable target", () => {
    expect(loadBar(101, 20, gym)).toEqual({
      kind: "unreachable",
      below: { totalKg: 100, perSideKg: [20, 20] },
      above: { totalKg: 105, perSideKg: [20, 20, 2.5] },
    });
  });

  it("handles a target that is not a whole number of hundredths per side", () => {
    // (20.5 − 20) / 2 = 0.25 kg per side, below the lightest plate.
    expect(loadBar(20.5, 20, gym)).toEqual({
      kind: "unreachable",
      below: { totalKg: 20, perSideKg: [] },
      above: { totalKg: 25, perSideKg: [2.5] },
    });
  });

  it("offers the bar alone when the target is under the bar", () => {
    expect(loadBar(15, 20, gym)).toEqual({
      kind: "unreachable",
      below: null,
      above: { totalKg: 20, perSideKg: [] },
    });
  });

  it("accepts a free value such as 1.25 kg without drifting", () => {
    expect(loadBar(62.5, 20, [20, 10, 5, 2.5, 1.25])).toEqual({
      kind: "exact",
      loading: { totalKg: 62.5, perSideKg: [20, 1.25] },
    });
  });

  it("has nothing above when there are no plates", () => {
    expect(loadBar(60, 20, [])).toEqual({
      kind: "unreachable",
      below: { totalKg: 20, perSideKg: [] },
      above: null,
    });
  });

  it("ignores duplicate and non-positive plates", () => {
    expect(loadBar(60, 20, [20, 20, 0, -5])).toEqual({
      kind: "exact",
      loading: { totalKg: 60, perSideKg: [20] },
    });
  });
});

describe("nearestLoading", () => {
  it("picks the closer of below and above, and the lighter on a tie", () => {
    expect(nearestLoading(104, 20, gym).totalKg).toBe(105);
    expect(nearestLoading(101, 20, gym).totalKg).toBe(100);
    expect(nearestLoading(102.5, 20, [20, 10, 5])).toEqual({ totalKg: 100, perSideKg: [20, 20] });
  });

  it("never goes under the bar", () => {
    expect(nearestLoading(12, 20, gym)).toEqual({ totalKg: 20, perSideKg: [] });
  });
});

describe("iwfColor", () => {
  it.each([
    [25, "red"],
    [20, "blue"],
    [15, "yellow"],
    [10, "green"],
    [5, "white"],
    [2.5, "red"],
    [2, "blue"],
    [1.5, "yellow"],
    [1, "green"],
    [0.5, "white"],
  ] as const)("%d kg is %s (IWF rule 3.3.3.6)", (kg, color) => {
    expect(iwfColor(kg)).toBe(color);
  });

  it("has no colour for 1.25 kg or any other value", () => {
    expect(iwfColor(1.25)).toBeNull();
    expect(iwfColor(7.5)).toBeNull();
  });
});
