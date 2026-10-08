import { describe, expect, it } from "vitest";
import {
  formatDay,
  formatKg,
  formatNumber,
  formatPlates,
  formatShortDay,
  formatWeekday,
  formatWeekRange,
  lossView,
  parseDecimal,
} from "./format";

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

describe("body formats", () => {
  const today = "2026-10-07";

  it("writes weights to the tenth with their decimal", () => {
    expect(formatKg(80, "fr")).toBe("80,0");
    expect(formatKg(79.84, "en")).toBe("79.8");
  });

  it("turns a weekly change into a loss or a gain, never -0", () => {
    expect(lossView(0.62)).toEqual({ kind: "loss", value: 0.6 });
    expect(lossView(-0.25)).toEqual({ kind: "gain", value: 0.3 });
    expect(lossView(-0.04)).toEqual({ kind: "loss", value: 0 });
    expect(Object.is(lossView(-0.04).value, -0)).toBe(false);
  });

  it("writes short days, 1er in French, and the year only when it is not this one", () => {
    expect(formatShortDay("2026-09-30", "fr", today)).toBe("30 sept.");
    expect(formatShortDay("2026-10-01", "fr", today)).toBe("1er oct.");
    expect(formatShortDay("2025-12-29", "fr", today)).toBe("29 déc. 2025");
    expect(formatShortDay("2026-09-30", "en", today)).toBe("Sep 30");
  });

  it("starts a line with the weekday, capitalised, or keeps it as the language writes it", () => {
    expect(formatWeekday("2026-09-30", "fr", today)).toBe("Mer. 30 sept.");
    expect(formatWeekday("2026-09-30", "fr", today, { startOfLine: false })).toBe("mer. 30 sept.");
    expect(formatWeekday("2026-09-30", "en", today)).toBe("Wed, Sep 30");
  });

  it("writes a week with its month once when it shares it", () => {
    expect(formatWeekRange("2026-09-22", "2026-09-28", "fr", today)).toBe("22 – 28 sept.");
    expect(formatWeekRange("2026-09-29", "2026-10-05", "fr", today)).toBe("29 sept. – 5 oct.");
    expect(formatWeekRange("2026-06-01", "2026-06-07", "fr", today)).toBe("1er – 7 juin");
    expect(formatWeekRange("2026-09-22", "2026-09-28", "en", today)).toBe("Sep 22 – 28");
    expect(formatWeekRange("2025-12-29", "2026-01-04", "fr", "2026-01-10")).toBe(
      "29 déc. 2025 – 4 janv.",
    );
  });
});
