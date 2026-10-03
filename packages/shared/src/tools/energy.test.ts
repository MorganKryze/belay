import { describe, expect, it } from "vitest";
import { dailyEnergy, mifflinStJeor, PAL_LEVELS } from "./energy";

const man = { formula: "male", ageYears: 30, heightCm: 180, weightKg: 80 } as const;
const woman = { formula: "female", ageYears: 40, heightCm: 165, weightKg: 60 } as const;

describe("Mifflin-St Jeor", () => {
  it("matches the worked example for the male formula", () => {
    // 10 × 80 + 6.25 × 180 − 5 × 30 + 5 = 800 + 1125 − 150 + 5
    expect(mifflinStJeor(man)).toBe(1780);
  });

  it("matches a hand calculation for the female formula", () => {
    // 10 × 60 + 6.25 × 165 − 5 × 40 − 161 = 600 + 1031.25 − 200 − 161
    expect(mifflinStJeor(woman)).toBe(1270.25);
  });
});

describe("dailyEnergy", () => {
  it("multiplies by the PAL and rounds everything to 10 kcal, with ±10 %", () => {
    // 1780 × 1.55 = 2759; × 0.9 = 2483.1; × 1.1 = 3034.9
    expect(dailyEnergy(man, 1.55)).toEqual({
      bmrKcal: 1780,
      dayKcal: 2760,
      lowKcal: 2480,
      highKcal: 3030,
    });
    // 1270.25 × 1.4 = 1778.35; × 0.9 = 1600.515; × 1.1 = 1956.185
    expect(dailyEnergy(woman, 1.4)).toEqual({
      bmrKcal: 1270,
      dayKcal: 1780,
      lowKcal: 1600,
      highKcal: 1960,
    });
  });

  it("only offers the four FAO values", () => {
    expect(PAL_LEVELS.map((l) => l.pal)).toEqual([1.4, 1.55, 1.75, 2]);
  });
});

describe("energy guards", () => {
  it.each([
    ["age", { ...man, ageYears: 14 }],
    ["age", { ...man, ageYears: 101 }],
    ["age NaN", { ...man, ageYears: NaN }],
    ["height", { ...man, heightCm: 119 }],
    ["height", { ...man, heightCm: 231 }],
    ["weight", { ...man, weightKg: 29 }],
    ["weight", { ...man, weightKg: 301 }],
    ["weight NaN", { ...man, weightKg: NaN }],
  ] as const)("rejects %s out of range", (_name, input) => {
    expect(() => mifflinStJeor(input)).toThrow(RangeError);
    expect(() => dailyEnergy(input, 1.55)).toThrow(RangeError);
  });

  it("rejects a non-positive or non-finite PAL", () => {
    expect(() => dailyEnergy(man, 0)).toThrow(RangeError);
    expect(() => dailyEnergy(man, NaN)).toThrow(RangeError);
  });
});
