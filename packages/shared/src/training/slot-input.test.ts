import { describe, expect, it } from "vitest";
import { parseCount, parseRange, parseRest, restClock } from "./slot-input";

describe("parseRange", () => {
  it.each([
    ["6-10", [6, 10]],
    ["6–10", [6, 10]],
    ["6—10", [6, 10]],
    ["6 10", [6, 10]],
    ["6 - 10", [6, 10]],
    ["6 à 10", [6, 10]],
    ["6à10", [6, 10]],
    ["6 to 10", [6, 10]],
    ["6 TO 10", [6, 10]],
    ["  8  ", [8, 8]],
    ["8", [8, 8]],
  ])("reads « %s »", (text, range) => {
    expect(parseRange(text, 1, 100)).toEqual(range);
  });

  it("puts a reversed pair in order", () => {
    expect(parseRange("10-6", 1, 100)).toEqual([6, 10]);
    expect(parseRange("4 0", 0, 4)).toEqual([0, 4]);
  });

  it("refuses a value outside the bounds", () => {
    expect(parseRange("0-10", 1, 100)).toBeNull();
    expect(parseRange("6-101", 1, 100)).toBeNull();
    expect(parseRange("5", 0, 4)).toBeNull();
    expect(parseRange("0", 0, 4)).toEqual([0, 0]);
    expect(parseRange("3600", 1, 3600)).toEqual([3600, 3600]);
  });

  it.each(["", " ", "abc", "6-", "-6", "6--10", "6-8-10", "6.5", "6,5-8", "1e2", "six"])(
    "refuses « %s »",
    (text) => {
      expect(parseRange(text, 0, 100)).toBeNull();
    },
  );
});

describe("parseRest", () => {
  it.each([
    ["2:30", 150],
    ["0:45", 45],
    ["15:00", 900],
    ["2 min 30", 150],
    ["2min30", 150],
    ["2 min 30 s", 150],
    ["2 min", 120],
    ["2 MIN", 120],
    ["2'30", 150],
    ["2’30", 150],
    ["150", 150],
    ["90 s", 90],
    ["0", 0],
    [" 2:30 ", 150],
  ])("reads « %s » as %i s", (text, seconds) => {
    expect(parseRest(text)).toBe(seconds);
  });

  it("refuses a rest past 15 min", () => {
    expect(parseRest("901")).toBeNull();
    expect(parseRest("15:01")).toBeNull();
    expect(parseRest("16 min")).toBeNull();
    expect(parseRest("900")).toBe(900);
  });

  it.each(["", "abc", "2:3", "2:60", "2 min 75", "2'", "1.5", "-30", "2:30:00", "min"])(
    "refuses « %s »",
    (text) => {
      expect(parseRest(text)).toBeNull();
    },
  );
});

describe("parseCount", () => {
  it("reads a whole number within its bounds", () => {
    expect(parseCount("4", 1, 10)).toBe(4);
    expect(parseCount(" 10 ", 1, 10)).toBe(10);
    expect(parseCount("0", 0, 3)).toBe(0);
  });

  it.each(["0", "11", "", "4.5", "4-5", "four", "-1"])("refuses « %s » for 1 to 10", (text) => {
    expect(parseCount(text, 1, 10)).toBeNull();
  });
});

describe("restClock", () => {
  it("writes a rest as a clock does", () => {
    expect(restClock(150)).toBe("2:30");
    expect(restClock(120)).toBe("2:00");
    expect(restClock(45)).toBe("0:45");
    expect(restClock(900)).toBe("15:00");
  });
});
