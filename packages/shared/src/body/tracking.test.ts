import { describe, expect, it } from "vitest";
import { isAnnotationLabel } from "./annotations";
import { addDays } from "./dates";
import { type IntakeLog, isKcal, isProteinG, weeklyIntake } from "./intake";
import { isMeasureCm, latestMeasures, type Measure, weeklyWaist } from "./measures";
import { ageIn, birthYearRange, EMPTY_PROFILE, isBirthYear, isProfileHeight } from "./profile";
import { creatineWindows, isCreatineName, isSupplementName } from "./supplements";
import { toolDefaults } from "./tool-defaults";
import type { Weighing } from "./weighings";

const MONDAY = "2026-09-28";
const TODAY = "2026-10-07";
const intake = (date: string, kcal: number | null, proteinG: number | null = null): IntakeLog => ({
  date,
  kcal,
  proteinG,
});
const measure = (date: string, m: Partial<Omit<Measure, "date">>): Measure => ({
  date,
  waistCm: null,
  neckCm: null,
  hipCm: null,
  ...m,
});
const w = (date: string, weightKg: number): Weighing => ({ date, weightKg });

describe("bounds", () => {
  it("takes whole calories from 0 to 10 000 and whole grams of protein from 0 to 500", () => {
    expect([0, 2130, 10_000].map(isKcal)).toEqual([true, true, true]);
    expect([-50, 10_050, 2100.5, Number.NaN].map(isKcal)).toEqual([false, false, false, false]);
    expect([0, 140, 500].map(isProteinG)).toEqual([true, true, true]);
    expect([505, 12.5, -5].map(isProteinG)).toEqual([false, false, false]);
  });

  it("takes each measurement inside the body-fat tool's limits, to the tenth", () => {
    expect(isMeasureCm("waist", 82)).toBe(true);
    expect(isMeasureCm("waist", 82.3)).toBe(true);
    expect(isMeasureCm("waist", 82.25)).toBe(false);
    expect(isMeasureCm("waist", 39.5)).toBe(false);
    expect(isMeasureCm("neck", 20)).toBe(true);
    expect(isMeasureCm("neck", 80.5)).toBe(false);
    expect(isMeasureCm("hip", 49.9)).toBe(false);
    expect(isMeasureCm("hip", 200)).toBe(true);
  });

  it("takes birth years for ages 15 to 100, following the calendar year", () => {
    expect(birthYearRange("2026-10-07")).toEqual({ min: 1926, max: 2011 });
    expect(birthYearRange("2027-01-01")).toEqual({ min: 1927, max: 2012 });
    expect([1926, 2011, 1995].map((y) => isBirthYear(y, TODAY))).toEqual([true, true, true]);
    expect([1925, 2012, 1995.5].map((y) => isBirthYear(y, TODAY))).toEqual([false, false, false]);
    expect(ageIn(1995, TODAY)).toBe(31);
  });

  it("takes a height of 120 to 230 cm, in whole centimetres", () => {
    expect([120, 178, 230].map(isProfileHeight)).toEqual([true, true, true]);
    expect([119, 231, 178.5].map(isProfileHeight)).toEqual([false, false, false]);
  });

  it("takes a supplement name of 1 to 40 characters on one line", () => {
    expect(isSupplementName("Vitamine D")).toBe(true);
    expect(isSupplementName("   ")).toBe(false);
    expect(isSupplementName("x".repeat(40))).toBe(true);
    expect(isSupplementName("x".repeat(41))).toBe(false);
    expect(isSupplementName("Fer\nZinc")).toBe(false);
  });

  it("takes no annotation text, or up to 80 characters on one line", () => {
    expect(isAnnotationLabel(null)).toBe(true);
    expect(isAnnotationLabel("voyage")).toBe(true);
    expect(isAnnotationLabel("x".repeat(80))).toBe(true);
    expect(isAnnotationLabel("x".repeat(81))).toBe(false);
    expect(isAnnotationLabel("a\nb")).toBe(false);
  });
});

describe("weeklyIntake", () => {
  it("has nothing for a week without an entry", () => {
    expect(weeklyIntake([intake("2026-10-05", 2000)], MONDAY)).toEqual({
      kcalAvg: null,
      proteinAvg: null,
      days: 0,
    });
  });

  it("averages one day as that day", () => {
    expect(weeklyIntake([intake("2026-09-30", 2100, 140)], MONDAY)).toEqual({
      kcalAvg: 2100,
      proteinAvg: 140,
      days: 1,
    });
  });

  it("averages the seven days of the week, Monday to Sunday", () => {
    const logs = Array.from({ length: 9 }, (_, i) =>
      intake(addDays("2026-09-27", i), 2000 + i * 50),
    );
    // 27 September (a Sunday) and 6 October fall outside the week.
    expect(weeklyIntake(logs, MONDAY)).toEqual({ kcalAvg: 2200, proteinAvg: null, days: 7 });
  });

  it("averages protein over the days that have it only", () => {
    const logs = [
      intake("2026-09-28", 2000, 120),
      intake("2026-09-29", 2200),
      intake("2026-09-30", 1800, 150),
      intake("2026-10-01", null, 100), // protein alone: not a calorie day
    ];
    expect(weeklyIntake(logs, MONDAY)).toEqual({ kcalAvg: 2000, proteinAvg: 370 / 3, days: 3 });
  });
});

describe("weeklyWaist", () => {
  it("is the last waist of the week, and null without one", () => {
    const measures = [
      measure("2026-09-29", { waistCm: 83 }),
      measure("2026-10-02", { waistCm: 82.5, neckCm: 39 }),
      measure("2026-10-03", { neckCm: 38.5 }), // no waist that day
      measure("2026-10-05", { waistCm: 82 }), // next week
    ];
    expect(weeklyWaist(measures, MONDAY)).toBe(82.5);
    expect(weeklyWaist(measures, "2026-09-21")).toBeNull();
  });

  it("finds the last value of each measurement, with its day", () => {
    expect(
      latestMeasures([
        measure("2026-10-02", { waistCm: 82.5, neckCm: 39 }),
        measure("2026-10-06", { waistCm: 82 }),
      ]),
    ).toEqual({ waist: { cm: 82, date: "2026-10-06" }, neck: { cm: 39, date: "2026-10-02" } });
  });
});

describe("creatineWindows", () => {
  it("marks 14 days from the first day ticked", () => {
    expect(creatineWindows(["2026-09-01", "2026-09-02", "2026-09-03"], TODAY)).toEqual([
      { start: "2026-09-01", end: "2026-09-14" },
    ]);
  });

  it("keeps one course through daily ticks, and through a pause of 13 days", () => {
    const daily = Array.from({ length: 30 }, (_, i) => addDays("2026-09-01", i));
    expect(creatineWindows(daily, TODAY)).toHaveLength(1);
    // Ticked on 1 September, then 13 days without (2 to 14), then 15 September.
    expect(creatineWindows(["2026-09-01", "2026-09-15"], TODAY)).toEqual([
      { start: "2026-09-01", end: "2026-09-14" },
    ]);
  });

  it("starts a new course after 14 days without", () => {
    // Ticked on 1 September, then 14 days without (2 to 15), then 16 September.
    expect(creatineWindows(["2026-09-01", "2026-09-16"], TODAY)).toEqual([
      { start: "2026-09-01", end: "2026-09-14" },
      { start: "2026-09-16", end: "2026-09-29" },
    ]);
  });

  it("marks a course in progress past today, and leaves out days after today", () => {
    expect(creatineWindows(["2026-10-05", "2026-10-09"], TODAY)).toEqual([
      { start: "2026-10-05", end: "2026-10-18" },
    ]);
  });

  it("runs across the new year, and counts a pause across it", () => {
    expect(creatineWindows(["2026-12-25", "2027-01-08", "2027-01-23"], "2027-01-31")).toEqual([
      { start: "2026-12-25", end: "2027-01-07" },
      { start: "2027-01-23", end: "2027-02-05" },
    ]);
  });

  it("counts a day ticked twice once", () => {
    expect(creatineWindows(["2026-09-01", "2026-09-01"], TODAY)).toHaveLength(1);
  });
});

describe("isCreatineName", () => {
  it.each([
    ["Créatine", true],
    ["creatine", true],
    ["CRÉATINE", true],
    ["Créatine monohydrate", true],
    ["Creatine", true],
    ["créatinine", false],
    ["Vitamine D", false],
    ["", false],
  ])("%s → %s", (name, ok) => expect(isCreatineName(name)).toBe(ok));
});

describe("toolDefaults", () => {
  const week = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"].map((d, i) =>
    w(d, 80 + i * 0.1),
  );

  it("is empty for an empty profile and no tracking", () => {
    expect(
      toolDefaults({ profile: EMPTY_PROFILE, weighings: [], measures: [], today: TODAY }),
    ).toEqual({});
  });

  it("takes the profile, the age from the birth year, the 7-day average and the measurements", () => {
    const d = toolDefaults({
      profile: { formula: "male", birthYear: 1995, heightCm: 178 },
      weighings: week,
      measures: [measure("2026-10-06", { waistCm: 82, neckCm: 39 })],
      today: TODAY,
    });
    expect(d).toEqual({
      formula: { value: "male", source: { from: "profile" } },
      ageYears: { value: 31, source: { from: "birthYear" } },
      heightCm: { value: 178, source: { from: "profile" } },
      weightKg: { value: 80.2, source: { from: "average" } }, // 80.15, to the tenth
      neckCm: { value: 39, source: { from: "measures", date: "2026-10-06" } },
      waistCm: { value: 82, source: { from: "measures", date: "2026-10-06" } },
    });
  });

  it("takes the last weigh-in without an average, or when the average is older", () => {
    const one = [w("2026-10-06", 79.8)];
    expect(
      toolDefaults({ profile: EMPTY_PROFILE, weighings: one, measures: [], today: TODAY }),
    ).toEqual({ weightKg: { value: 79.8, source: { from: "weighing" } } });
    const later = [...week, w("2026-10-20", 78.6)];
    expect(
      toolDefaults({ profile: EMPTY_PROFILE, weighings: later, measures: [], today: "2026-10-21" })
        .weightKg,
    ).toEqual({ value: 78.6, source: { from: "weighing" } });
  });

  it("leaves out a value outside the tools' bounds, so the tool keeps the device's", () => {
    const d = toolDefaults({
      profile: { formula: null, birthYear: 1920, heightCm: 178 }, // 106 years old today
      weighings: [w("2026-10-06", 22)], // a weigh-in the tools (30 to 300 kg) cannot take
      measures: [],
      today: TODAY,
    });
    expect(d).toEqual({ heightCm: { value: 178, source: { from: "profile" } } });
  });
});
