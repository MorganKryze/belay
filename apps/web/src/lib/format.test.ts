import { describe, expect, it } from "vitest";
import { formatDay, formatNumber, formatPlates, parseDecimal } from "./format";

describe("parseDecimal", () => {
  it.each([
    ["72,5", 72.5],
    ["72.5", 72.5],
    [" 72 ", 72],
    ["1 790", 1790],
    ["72,", 72],
    [",5", 0.5],
  ])("%j → %d", (text, value) => {
    expect(parseDecimal(text)).toBe(value);
  });

  it.each(["", "abc", "7,2,5", "-3", "1e3", "72kg"])("%j → null", (text) => {
    expect(parseDecimal(text)).toBeNull();
  });
});

describe("formatNumber", () => {
  it("uses the decimal comma in French and the point in English", () => {
    expect(formatNumber(24.3, "fr")).toBe("24,3");
    expect(formatNumber(24.3, "en")).toBe("24.3");
  });

  it("groups thousands in results but not in inputs", () => {
    expect(formatNumber(2770, "fr")).toBe("2 770");
    expect(formatNumber(2770, "fr", { grouping: false })).toBe("2770");
  });

  it("keeps trailing zeros only when asked", () => {
    expect(formatNumber(25, "fr", { minDigits: 1 })).toBe("25,0");
    expect(formatNumber(25, "fr")).toBe("25");
  });
});

describe("formatPlates", () => {
  it("joins plates with the locale's separator", () => {
    expect(formatPlates([20, 5, 2.5], "fr")).toBe("20 + 5 + 2,5");
    expect(formatPlates([20, 1.25], "en")).toBe("20 + 1.25");
  });
});

describe("formatDay", () => {
  const today = new Date(2026, 9, 3);
  it("omits this year and shows any other year", () => {
    expect(formatDay(new Date(2026, 11, 26), "fr", today)).toBe("26 décembre");
    expect(formatDay(new Date(2027, 0, 23), "fr", today)).toBe("23 janvier 2027");
    expect(formatDay(new Date(2027, 0, 23), "en", today)).toBe("January 23, 2027");
  });

  it("writes the first of the month as 1er in French only", () => {
    expect(formatDay(new Date(2026, 10, 1), "fr", today)).toBe("1er novembre");
    expect(formatDay(new Date(2027, 0, 1), "fr", today)).toBe("1er janvier 2027");
    expect(formatDay(new Date(2026, 10, 11), "fr", today)).toBe("11 novembre");
    expect(formatDay(new Date(2026, 10, 1), "en", today)).toBe("November 1");
  });
});
