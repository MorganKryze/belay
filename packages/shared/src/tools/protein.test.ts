import { describe, expect, it } from "vitest";
import { proteinRange } from "./protein";

const day = (r: ReturnType<typeof proteinRange>) => [r.lowG, r.highG];

describe("proteinRange", () => {
  it("maintain: 1.4–2.0 g/kg of body weight, rounded to 5 g", () => {
    // 112–160 g
    expect(proteinRange(80, "maintain")).toEqual({
      lowG: 110,
      highG: 160,
      basis: "body-weight",
      floorApplied: false,
      perMeal3: [40, 50],
      perMeal4: [30, 40],
    });
  });

  it("gain: 1.6–2.2 g/kg of body weight", () => {
    expect(day(proteinRange(80, "gain"))).toEqual([130, 175]); // 128–176
  });

  it("ignores body fat outside a cut", () => {
    expect(proteinRange(80, "maintain", 25)).toEqual(proteinRange(80, "maintain"));
  });

  it("cut with body fat: 2.3–3.1 g/kg of lean mass (Helms worked examples)", () => {
    const r = proteinRange(80, "cut", 25); // lean 60 kg → 138–186 g
    expect(day(r)).toEqual([140, 185]);
    expect(r.basis).toBe("lean-mass");
    expect(r.floorApplied).toBe(false);
    expect(day(proteinRange(70, "cut", 15))).toEqual([135, 185]); // lean 59.5 → 136.85–184.45
  });

  it("cut without body fat falls back to 1.8–2.5 g/kg of body weight", () => {
    const r = proteinRange(80, "cut");
    expect(day(r)).toEqual([145, 200]); // 144–200
    expect(r.basis).toBe("no-body-fat");
  });

  it("cut never goes below 1.6 g/kg of body weight", () => {
    const r = proteinRange(100, "cut", 40); // lean 60 → 138–186, floor 160
    expect(day(r)).toEqual([160, 185]);
    expect(r.floorApplied).toBe(true);
    // Both ends under the floor: the range closes on it.
    expect(day(proteinRange(100, "cut", 75))).toEqual([160, 160]);
  });

  it("rounds the floor up so the shown low end is never under 1.6 g/kg", () => {
    const r = proteinRange(82, "cut", 45); // floor 131.2
    expect(r.floorApplied).toBe(true);
    expect(r.lowG).toBe(135);
    expect(r.lowG).toBeGreaterThanOrEqual(131.2);
    expect(r.highG).toBeGreaterThanOrEqual(r.lowG);
  });

  it("keeps the per-meal amounts inside the daily range", () => {
    for (const [w, g, bf] of [
      [80, "maintain", undefined],
      [82, "cut", 45],
      [100, "cut", 75],
      [63, "gain", undefined],
    ] as const) {
      const r = proteinRange(w, g, bf);
      expect(r.perMeal3[1] * 3).toBeLessThanOrEqual(r.highG);
      expect(r.perMeal4[1] * 4).toBeLessThanOrEqual(r.highG);
      expect(r.perMeal3[0]).toBeLessThanOrEqual(r.perMeal3[1]);
      expect(r.perMeal4[0]).toBeLessThanOrEqual(r.perMeal4[1]);
    }
  });

  it("rejects a bad weight or body fat", () => {
    expect(() => proteinRange(NaN, "maintain")).toThrow(RangeError);
    expect(() => proteinRange(-5, "gain")).toThrow(RangeError);
    expect(() => proteinRange(80, "cut", NaN)).toThrow(RangeError);
    expect(() => proteinRange(80, "cut", 1.9)).toThrow(RangeError);
    expect(() => proteinRange(80, "cut", 75.1)).toThrow(RangeError);
    expect(() => proteinRange(80, "cut", 2)).not.toThrow();
  });
});
