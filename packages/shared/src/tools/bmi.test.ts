import { describe, expect, it } from "vitest";
import { bmi, bmiBand, bmiSuggestsProfessional } from "./bmi";

describe("bmi", () => {
  it("divides weight by height squared and rounds to 0.1", () => {
    expect(bmi(77, 178)).toBe(24.3);
    expect(bmi(75, 175)).toBe(24.5);
  });

  it("classifies the shown value, so 24.97 shows 25.0 and sits in 25 – 30", () => {
    const value = bmi(80.9, 180); // raw 24.969
    expect(value).toBe(25);
    expect(bmiBand(value)).toBe("above");
  });
});

describe("bmiBand", () => {
  it.each([
    [18.4, "below"],
    [18.5, "reference"],
    [24.9, "reference"],
    [25, "above"],
    [29.9, "above"],
    [30, "well-above"],
    [42, "well-above"],
  ] as const)("%d → %s", (value, band) => {
    expect(bmiBand(value)).toBe(band);
  });
});

describe("bmiSuggestsProfessional", () => {
  it.each([
    [18.4, true],
    [18.5, false],
    [34.9, false],
    [35, true],
  ] as const)("%d → %s", (value, expected) => {
    expect(bmiSuggestsProfessional(value)).toBe(expected);
  });
});
