import { describe, expect, it } from "vitest";
import { ageGroup, bodyFatBand, gallagherThresholds, navyBodyFat } from "./body-fat";

describe("navyBodyFat", () => {
  it("reproduces the DoD male test vector in centimetres", () => {
    // 34 in abdomen, 15.5 in neck, 70 in height
    const r = navyBodyFat({ formula: "male", heightCm: 177.8, neckCm: 39.37, waistCm: 86.36 });
    if (r.kind !== "ok") throw new Error("expected a result");
    expect(r.exact).toBeCloseTo(16.517, 3);
    expect(r.percent).toBe(17);
  });

  it("reproduces the DoD female test vector in centimetres", () => {
    // 28 in waist, 38 in hip, 13 in neck, 65 in height
    const r = navyBodyFat({
      formula: "female",
      heightCm: 165.1,
      neckCm: 33.02,
      waistCm: 71.12,
      hipCm: 96.52,
    });
    if (r.kind !== "ok") throw new Error("expected a result");
    expect(r.exact).toBeCloseTo(25.931, 3);
    expect(r.percent).toBe(26);
  });

  it("refuses girths whose difference is zero or negative instead of taking its log", () => {
    expect(navyBodyFat({ formula: "male", heightCm: 178, neckCm: 40, waistCm: 40 })).toEqual({
      kind: "invalid-girths",
    });
    expect(navyBodyFat({ formula: "male", heightCm: 178, neckCm: 45, waistCm: 40 })).toEqual({
      kind: "invalid-girths",
    });
    expect(
      navyBodyFat({ formula: "female", heightCm: 165, neckCm: 200, waistCm: 70, hipCm: 90 }),
    ).toEqual({ kind: "invalid-girths" });
    expect(navyBodyFat({ formula: "female", heightCm: 165, neckCm: 33, waistCm: 70 })).toEqual({
      kind: "invalid-girths",
    });
  });

  it("shows no number when the equation leaves its plausible range", () => {
    // waist − neck = 1 cm: log10(1) = 0, so the result is about −127 %.
    expect(navyBodyFat({ formula: "male", heightCm: 178, neckCm: 40, waistCm: 41 }).kind).toBe(
      "out-of-range",
    );
  });
});

describe("navyBodyFat range guard on the shown value", () => {
  it("accepts an exact 1.7 that shows as 2", () => {
    const r = navyBodyFat({ formula: "male", heightCm: 178, neckCm: 40, waistCm: 71.63 });
    expect(r).toMatchObject({ kind: "ok", percent: 2 });
  });

  it("accepts an exact 74.6 that shows as 75", () => {
    const r = navyBodyFat({ formula: "male", heightCm: 178, neckCm: 40, waistCm: 262.7 });
    expect(r).toMatchObject({ kind: "ok", percent: 75 });
  });

  it("refuses non-finite measures", () => {
    expect(navyBodyFat({ formula: "male", heightCm: NaN, neckCm: 40, waistCm: 90 })).toEqual({
      kind: "invalid-girths",
    });
    expect(navyBodyFat({ formula: "male", heightCm: 178, neckCm: 40, waistCm: Infinity })).toEqual({
      kind: "invalid-girths",
    });
  });
});

describe("age guards", () => {
  it("treats a NaN age as outside 20–79", () => {
    expect(ageGroup(NaN)).toBeNull();
    expect(gallagherThresholds("male", NaN, "standard")).toBeNull();
    expect(gallagherThresholds("female", -1, "asian")).toBeNull();
  });
});

describe("Gallagher 2000 thresholds", () => {
  it.each([
    ["standard", "female", 30, [21, 33, 39]],
    ["standard", "female", 50, [23, 34, 40]],
    ["standard", "female", 70, [24, 36, 42]],
    ["standard", "male", 30, [8, 20, 25]],
    ["standard", "male", 50, [11, 22, 28]],
    ["standard", "male", 70, [13, 25, 30]],
    ["asian", "female", 30, [25, 35, 40]],
    ["asian", "female", 50, [25, 35, 41]],
    ["asian", "female", 70, [25, 36, 41]],
    ["asian", "male", 30, [13, 23, 28]],
    ["asian", "male", 50, [13, 24, 29]],
    ["asian", "male", 70, [14, 24, 29]],
  ] as const)("%s %s at %d → %j (tables 4 and 5)", (reference, formula, age, values) => {
    const r = gallagherThresholds(formula, age, reference);
    expect(r && [r.thresholds.at18_5, r.thresholds.at25, r.thresholds.at30]).toEqual(values);
  });

  it.each([
    [19, null],
    [20, "20-39"],
    [39, "20-39"],
    [40, "40-59"],
    [59, "40-59"],
    [60, "60-79"],
    [79, "60-79"],
    [80, null],
  ] as const)("age %d → %s", (age, group) => {
    expect(ageGroup(age)).toBe(group);
  });

  it("has no thresholds outside 20–79", () => {
    expect(gallagherThresholds("male", 18, "standard")).toBeNull();
    expect(gallagherThresholds("female", 85, "asian")).toBeNull();
  });

  it.each([
    [7, "below"],
    [8, "reference"],
    [19, "reference"],
    [20, "above"],
    [24, "above"],
    [25, "well-above"],
  ] as const)("male 20–39: %d %% → %s", (percent, band) => {
    expect(bodyFatBand(percent, { at18_5: 8, at25: 20, at30: 25 })).toBe(band);
  });
});
