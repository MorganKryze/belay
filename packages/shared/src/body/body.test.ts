import { describe, expect, it } from "vitest";
import { addDays, isoWeekStart, toISODate } from "./dates";
import { DEFAULT_TARGET, inTargetRange, isTargetRange } from "./target";
import {
  isWeighingKg,
  latestMovingAverage,
  movingAverage7,
  movingAverageSeries,
  type Weighing,
  weeklySummaries,
} from "./weighings";

const w = (date: string, weightKg: number): Weighing => ({ date, weightKg });
// Wednesday 7 October 2026: the current ISO week runs from Monday 5 October.
const TODAY = "2026-10-07";
const weekOf = (monday: string, kgs: number[]) => kgs.map((kg, i) => w(addDays(monday, i), kg));

describe("dates", () => {
  it("finds the Monday of the ISO week, across the new year", () => {
    expect(isoWeekStart("2026-01-01")).toBe("2025-12-29"); // week 1 of 2026 starts in 2025
    expect(isoWeekStart("2026-10-05")).toBe("2026-10-05"); // a Monday is its own start
    expect(isoWeekStart("2026-10-11")).toBe("2026-10-05"); // Sunday closes the week
    expect(isoWeekStart("2027-01-03")).toBe("2026-12-28");
    expect(isoWeekStart("2028-02-29")).toBe("2028-02-28");
  });

  it("adds days through 29 February, the year end and a daylight-saving change", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("reads the local calendar day of a clock", () => {
    expect(toISODate(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
    expect(toISODate(new Date(2026, 9, 8, 0, 1))).toBe("2026-10-08");
  });
});

describe("isWeighingKg", () => {
  it.each([
    [20, true],
    [400, true],
    [79.8, true],
    [19.9, false],
    [400.1, false],
    [79.85, false],
    [Number.NaN, false],
  ])("%s → %s", (kg, ok) => expect(isWeighingKg(kg)).toBe(ok));
});

describe("movingAverage7", () => {
  it("needs 4 weigh-ins in the 7 days ending on the day", () => {
    const three = [w("2026-10-01", 80), w("2026-10-03", 81), w("2026-10-07", 82)];
    expect(movingAverage7(three, "2026-10-07")).toBeNull();
    const four = [...three, w("2026-10-05", 79)];
    expect(movingAverage7(four, "2026-10-07")).toBeCloseTo(80.5, 10);
  });

  it("drops a weigh-in older than 6 days before the day", () => {
    const ws = [w("2026-09-30", 90), ...weekOf("2026-10-04", [80, 80, 80, 80])];
    expect(movingAverage7(ws, "2026-10-07")).toBeCloseTo(80, 10); // 30 Sept is out of [1, 7] Oct
    expect(movingAverage7(ws, "2026-10-06")).toBeCloseTo(82.5, 10); // 30 Sept is in [30 Sept, 6 Oct]
  });

  it("runs through 29 February", () => {
    const ws = weekOf("2028-02-26", [80, 81, 82, 83]); // 26, 27, 28, 29 February 2028
    expect(movingAverage7(ws, "2028-03-01")).toBeCloseTo(81.5, 10);
    expect(movingAverageSeries(ws, "2028-02-28", "2028-03-04").map((p) => p.date)).toEqual([
      "2028-02-29",
      "2028-03-01",
      "2028-03-02",
      "2028-03-03",
    ]);
  });
});

describe("latestMovingAverage", () => {
  it("gives the most recent day that has an average", () => {
    const ws = weekOf("2026-09-28", [80, 80, 80, 80]); // 28 Sept to 1 Oct
    expect(latestMovingAverage(ws, TODAY)).toEqual({ date: "2026-10-04", averageKg: 80 });
  });

  it("is null before the first 4 weigh-ins", () => {
    expect(latestMovingAverage([], TODAY)).toBeNull();
    expect(latestMovingAverage(weekOf("2026-10-05", [80, 81, 82]), TODAY)).toBeNull();
  });
});

describe("weeklySummaries", () => {
  const before = weekOf("2026-09-21", [80, 80.4, 80.2, 80.6]); // average 80.3
  const last = weekOf("2026-09-28", [79.8, 79.6, 80, 79.8]); // average 79.8

  it("compares the last complete week with the one before, most recent first", () => {
    const weeks = weeklySummaries([...before, ...last], TODAY);
    expect(weeks.map((s) => [s.start, s.end, s.status, s.count])).toEqual([
      ["2026-10-05", "2026-10-11", "in_progress", 0],
      ["2026-09-28", "2026-10-04", "valid", 4],
      ["2026-09-21", "2026-09-27", "valid", 4],
    ]);
    expect(weeks[1]!.averageKg).toBeCloseTo(79.8, 10);
    expect(weeks[1]!.lossPct).toBeCloseTo(((80.3 - 79.8) / 80.3) * 100, 10); // 0.62 %
    expect(weeks[2]!.lossPct).toBeNull(); // nothing before the first week
  });

  it("never makes the current week valid, even with 7 weigh-ins", () => {
    const now = weekOf("2026-10-05", [79, 79, 79, 79, 79, 79, 79]);
    const [current] = weeklySummaries([...last, ...now], "2026-10-11");
    expect(current).toMatchObject({
      status: "in_progress",
      count: 7,
      averageKg: null,
      lossPct: null,
    });
  });

  it("gives no loss when either week is insufficient", () => {
    const three = weekOf("2026-09-21", [80, 80.4, 80.2]);
    const weeks = weeklySummaries([...three, ...last], TODAY);
    expect(weeks[2]).toMatchObject({ status: "insufficient", count: 3, averageKg: null });
    expect(weeks[1]).toMatchObject({ status: "valid", lossPct: null });
  });

  it("reports a gain as a negative loss", () => {
    const gain = weekOf("2026-09-28", [80.5, 80.5, 80.5, 80.5]);
    const [, week] = weeklySummaries([...before, ...gain], TODAY);
    expect(week!.lossPct).toBeCloseTo(((80.3 - 80.5) / 80.3) * 100, 10); // −0.25 %
  });

  it("keeps an empty week between two weeks as insufficient", () => {
    const gap = [...weekOf("2026-09-14", [81, 81, 81, 81]), ...last];
    const weeks = weeklySummaries(gap, TODAY);
    expect(weeks.map((s) => [s.start, s.status, s.count])).toEqual([
      ["2026-10-05", "in_progress", 0],
      ["2026-09-28", "valid", 4],
      ["2026-09-21", "insufficient", 0],
      ["2026-09-14", "valid", 4],
    ]);
    expect(weeks[1]!.lossPct).toBeNull();
  });

  it("keeps a week that straddles the new year whole", () => {
    const ws = weekOf("2026-12-28", [80, 80, 80, 80, 80, 80, 80]); // 28 Dec to 3 Jan
    const [week] = weeklySummaries(ws, "2027-01-04").slice(1);
    expect(week).toMatchObject({
      start: "2026-12-28",
      end: "2027-01-03",
      count: 7,
      status: "valid",
    });
  });

  it("counts a weigh-in dated after today (a timezone change) in a week in progress", () => {
    const weeks = weeklySummaries([w("2026-10-12", 80)], "2026-10-11");
    expect(weeks.map((s) => [s.start, s.status, s.count])).toEqual([
      ["2026-10-12", "in_progress", 1],
      ["2026-10-05", "in_progress", 0],
    ]);
  });

  it("is empty without a weigh-in", () => {
    expect(weeklySummaries([], TODAY)).toEqual([]);
  });
});

describe("target range", () => {
  it("defaults to 0.5 to 1 % per week", () => {
    expect(DEFAULT_TARGET).toEqual({ minPct: 0.5, maxPct: 1 });
    expect(isTargetRange(DEFAULT_TARGET)).toBe(true);
  });

  it.each([
    [0.25, 1, true],
    [0.85, 0.95, true], // 0.95 − 0.1 is 0.8499… in floats: checked in hundredths
    [0.9, 1, true],
    [0.2, 1, false],
    [0.5, 1.05, false],
    [0.9, 0.95, false],
    [0.33, 1, false],
  ])("%s to %s → %s", (minPct, maxPct, ok) => expect(isTargetRange({ minPct, maxPct })).toBe(ok));

  it("compares the loss as shown, to the tenth, at both bounds", () => {
    expect(inTargetRange(0.5, DEFAULT_TARGET)).toBe(true);
    expect(inTargetRange(1, DEFAULT_TARGET)).toBe(true);
    expect(inTargetRange(0.45, DEFAULT_TARGET)).toBe(true); // shown as 0.5
    expect(inTargetRange(0.44, DEFAULT_TARGET)).toBe(false); // shown as 0.4
    expect(inTargetRange(1.04, DEFAULT_TARGET)).toBe(true); // shown as 1.0
    expect(inTargetRange(1.05, DEFAULT_TARGET)).toBe(false); // shown as 1.1
    expect(inTargetRange(-0.3, DEFAULT_TARGET)).toBe(false);
  });
});
