import { describe, expect, it } from "vitest";
import type { ISODate } from "../body/dates";
import { stepsToWrite } from "./steps-import";

const day = (date: ISODate, total: number | null) => ({ date, total });
const rows = (entries: [ISODate, number | null][] = []) => new Map(entries);
const own = (entries: [ISODate, number][] = []) => new Map(entries);

describe("the steps a Health import writes", () => {
  it("writes a day that holds no steps", () => {
    expect(stepsToWrite([day("2026-11-10", 8437)], rows(), own())).toEqual([
      { date: "2026-11-10", value: 8437 },
    ]);
  });

  it("leaves alone a day whose steps were deleted", () => {
    expect(stepsToWrite([day("2026-11-10", 8437)], rows([["2026-11-10", null]]), own())).toEqual([]);
  });

  it("follows Health on a day it wrote itself", () => {
    expect(
      stepsToWrite(
        [day("2026-11-10", 9120)],
        rows([["2026-11-10", 8437]]),
        own([["2026-11-10", 8437]]),
      ),
    ).toEqual([{ date: "2026-11-10", value: 9120 }]);
  });

  it("keeps a value typed elsewhere", () => {
    expect(stepsToWrite([day("2026-11-10", 9120)], rows([["2026-11-10", 6000]]), own())).toEqual(
      [],
    );
    // The import wrote 8 437, then the web typed 6 000: the typed value stays.
    expect(
      stepsToWrite(
        [day("2026-11-10", 9120)],
        rows([["2026-11-10", 6000]]),
        own([["2026-11-10", 8437]]),
      ),
    ).toEqual([]);
  });

  it("skips a day past 100 000 steps", () => {
    expect(stepsToWrite([day("2026-11-10", 100_001)], rows(), own())).toEqual([]);
    expect(stepsToWrite([day("2026-11-10", 100_000)], rows(), own())).toEqual([
      { date: "2026-11-10", value: 100_000 },
    ]);
  });

  it("skips a day with no samples", () => {
    expect(stepsToWrite([day("2026-11-10", null)], rows(), own())).toEqual([]);
  });

  it("skips a day whose steps are already the total", () => {
    expect(
      stepsToWrite(
        [day("2026-11-10", 8437)],
        rows([["2026-11-10", 8437]]),
        own([["2026-11-10", 8437]]),
      ),
    ).toEqual([]);
  });

  it("rounds the total to whole steps", () => {
    expect(stepsToWrite([day("2026-11-10", 8436.6)], rows(), own())).toEqual([
      { date: "2026-11-10", value: 8437 },
    ]);
  });

  it("decides each day on its own, in the order given", () => {
    expect(
      stepsToWrite(
        [day("2026-11-09", 4000), day("2026-11-10", 9120), day("2026-11-11", 120)],
        rows([["2026-11-10", 6000]]),
        own(),
      ),
    ).toEqual([
      { date: "2026-11-09", value: 4000 },
      { date: "2026-11-11", value: 120 },
    ]);
  });
});
