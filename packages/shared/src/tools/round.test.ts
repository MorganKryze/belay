import { describe, expect, it } from "vitest";
import { decimalsOf, roundTo } from "./round";

describe("roundTo", () => {
  it.each([
    [116.6667, 0.5, 116.5],
    [112.5, 0.5, 112.5],
    [2759, 10, 2760],
    [24.3024, 0.1, 24.3],
    [0.1 + 0.2, 0.1, 0.3],
    [0.85000000001, 0.05, 0.85],
    [137.6, 5, 140],
  ])("roundTo(%d, %d) = %d", (value, step, expected) => {
    expect(roundTo(value, step)).toBe(expected);
  });

  it.each([
    [2.5, 1],
    [0.05, 2],
    [10, 0],
    [1, 0],
  ])("decimalsOf(%d) = %d", (step, expected) => {
    expect(decimalsOf(step)).toBe(expected);
  });
});
