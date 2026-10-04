import { describe, expect, it } from "vitest";
import { addWeeks, kgPerWeek, projectLoss, rateWarning, slowWeeks } from "./projection";

const ymd = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate()];
const today = new Date(2026, 9, 3); // 3 October 2026, local time

describe("projectLoss", () => {
  it("gives the low and high week counts", () => {
    // ln(75/82) / ln(1 − 0.0075) = 11.85 → 12; ⌈1.3 × 12⌉ = 16
    const p = projectLoss(82, 75, 0.75, today);
    expect(p).toMatchObject({ kind: "ok", weeksLow: 12, weeksHigh: 16 });
    // 85 → 78 at 0.7 %: 12.23 → 13; ⌈1.3 × 13⌉ = 17
    expect(projectLoss(85, 78, 0.7, today)).toMatchObject({ weeksLow: 13, weeksHigh: 17 });
  });

  it("turns weeks into calendar dates across the new year", () => {
    const p = projectLoss(82, 75, 0.75, today);
    if (p.kind !== "ok") throw new Error("expected a projection");
    expect(ymd(p.dateLow)).toEqual([2026, 12, 26]);
    expect(ymd(p.dateHigh)).toEqual([2027, 1, 23]);
  });

  it("refuses a target at or above the current weight", () => {
    expect(projectLoss(80, 80, 0.75, today)).toEqual({ kind: "target-not-below" });
    expect(projectLoss(80, 85, 0.75, today)).toEqual({ kind: "target-not-below" });
  });

  it("needs at least one week for a tiny loss", () => {
    expect(projectLoss(80, 79.9, 1, today)).toMatchObject({ weeksLow: 1, weeksHigh: 2 });
  });
});

describe("projectLoss guards", () => {
  it.each([
    ["rate 0", 82, 75, 0],
    ["rate negative", 82, 75, -1],
    ["rate below 0.25", 82, 75, 0.2],
    ["rate above 2.5", 82, 75, 2.6],
    ["rate NaN", 82, 75, NaN],
    ["target 0", 82, 0, 0.75],
    ["target negative", 82, -3, 0.75],
    ["target NaN", 82, NaN, 0.75],
    ["current 0", 0, -1, 0.75],
    ["current NaN", NaN, 75, 0.75],
  ])("rejects %s", (_name, current, target, rate) => {
    expect(() => projectLoss(current, target, rate, today)).toThrow(RangeError);
  });

  it("accepts the bounds 0.25 and 2.5", () => {
    expect(projectLoss(82, 75, 0.25, today).kind).toBe("ok");
    expect(projectLoss(82, 75, 2.5, today).kind).toBe("ok");
  });
});

describe("helpers", () => {
  it("computes ⌈1.3 n⌉ in integers", () => {
    expect(slowWeeks(10)).toBe(13);
    expect(slowWeeks(12)).toBe(16);
    expect(slowWeeks(1)).toBe(2);
  });

  it("adds calendar weeks without hour drift", () => {
    expect(ymd(addWeeks(new Date(2026, 9, 20), 1))).toEqual([2026, 10, 27]); // across DST end
    expect(ymd(addWeeks(new Date(2026, 10, 20), 12))).toEqual([2027, 2, 12]);
    expect(addWeeks(new Date(2026, 9, 20), 1).getHours()).toBe(0);
  });

  it("grades the pace", () => {
    expect(rateWarning(1)).toBe("none");
    expect(rateWarning(1.05)).toBe("above-1");
    expect(rateWarning(1.5)).toBe("above-1");
    expect(rateWarning(1.55)).toBe("above-1.5");
  });

  it("converts a pace to kg per week at the current weight", () => {
    expect(kgPerWeek(82, 0.5)).toBeCloseTo(0.41, 5);
  });
});
