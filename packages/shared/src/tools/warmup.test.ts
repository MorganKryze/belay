import { describe, expect, it } from "vitest";
import { PLATE_PRESETS } from "./plates";
import { defaultWarmupCount, warmupSets } from "./warmup";

const gym = PLATE_PRESETS.gym.platesKg;

describe("defaultWarmupCount", () => {
  it.each([
    [40, 1],
    [59.5, 1],
    [60, 2],
    [119.5, 2],
    [120, 3],
    [200, 3],
  ])("%d kg → %d sets", (work, count) => {
    expect(defaultWarmupCount(work)).toBe(count);
  });
});

describe("warmupSets", () => {
  it("follows the two-set scheme, rounded to the gym preset", () => {
    expect(warmupSets(100, 2, 20, gym)).toEqual([
      { loadKg: 50, reps: 5, perSideKg: [10, 5] },
      { loadKg: 75, reps: 3, perSideKg: [20, 5, 2.5] },
    ]);
  });

  it("follows the three-set scheme", () => {
    expect(warmupSets(100, 3, 20, gym)).toEqual([
      { loadKg: 40, reps: 5, perSideKg: [10] },
      { loadKg: 60, reps: 3, perSideKg: [20] },
      { loadKg: 80, reps: 1, perSideKg: [20, 10] },
    ]);
  });

  it("rounds each load to the nearest load the equipment allows", () => {
    // 52 → 50, 78 → 80, 104 → 105 with 2.5 kg steps per side.
    expect(warmupSets(130, 3, 20, gym).map((s) => s.loadKg)).toEqual([50, 80, 105]);
  });

  it("puts a set under the bar on the bar alone", () => {
    expect(warmupSets(30, 1, 20, gym)).toEqual([{ loadKg: 20, reps: 5, perSideKg: [] }]);
  });

  it("merges sets that round to the same load", () => {
    expect(warmupSets(30, 3, 20, gym)).toEqual([
      { loadKg: 20, reps: 5, perSideKg: [] },
      { loadKg: 25, reps: 1, perSideKg: [2.5] },
    ]);
  });

  it("collapses a warm-up entirely at the bar into one set", () => {
    expect(warmupSets(26, 3, 20, gym)).toEqual([{ loadKg: 20, reps: 5, perSideKg: [] }]);
  });

  it("returns nothing for 0 sets or a working load at or under the bar", () => {
    expect(warmupSets(100, 0, 20, gym)).toEqual([]);
    expect(warmupSets(20, 2, 20, gym)).toEqual([]);
    expect(warmupSets(15, 1, 20, gym)).toEqual([]);
  });
});
