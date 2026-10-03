import { describe, expect, it } from "vitest";
import { brzycki, epley, oneRepMax } from "./one-rep-max";
import { roundTo } from "./round";

describe("one-rep max", () => {
  it("returns the load itself at 1 rep, for both formulas", () => {
    expect(epley(100, 1)).toBe(100);
    expect(brzycki(100, 1)).toBe(100);
  });

  it("matches the formulas printed in Reynolds 2006, table 5", () => {
    // Epley: w × (1 + r/30). Brzycki: w / (1.0278 − 0.0278 r), i.e. w × 36 / (37 − r).
    expect(epley(100, 5)).toBeCloseTo(116.667, 3);
    expect(brzycki(100, 5)).toBe(112.5);
    expect(brzycki(100, 5)).toBeCloseTo(100 / (1.0278 - 0.0278 * 5), 1);
  });

  it("gives the same value for both at 10 reps", () => {
    expect(epley(100, 10)).toBeCloseTo(133.333, 3);
    expect(brzycki(100, 10)).toBeCloseTo(133.333, 3);
  });

  it("rounds to 0.5 kg for display", () => {
    const r = oneRepMax(100, 5);
    expect(roundTo(r.epleyKg, 0.5)).toBe(116.5);
    expect(roundTo(r.brzyckiKg, 0.5)).toBe(112.5);
  });

  it("rejects a NaN, zero or negative weight", () => {
    expect(() => oneRepMax(NaN, 5)).toThrow(RangeError);
    expect(() => oneRepMax(-80, 5)).toThrow(RangeError);
    expect(() => oneRepMax(0, 5)).toThrow(RangeError);
  });

  it("flags 11 and 12 reps as less reliable, and refuses more", () => {
    expect(oneRepMax(80, 10).lessReliable).toBe(false);
    expect(oneRepMax(80, 11).lessReliable).toBe(true);
    expect(oneRepMax(80, 12).lessReliable).toBe(true);
    expect(() => oneRepMax(80, 13)).toThrow(RangeError);
    expect(() => oneRepMax(80, 0)).toThrow(RangeError);
    expect(() => oneRepMax(80, 2.5)).toThrow(RangeError);
  });
});
