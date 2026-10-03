import { describe, expect, it } from "vitest";
import { monthCells } from "./month-strip";

const today = new Date(2026, 9, 3);

describe("monthCells", () => {
  it("runs from this month to the month after the window, across the new year", () => {
    const cells = monthCells(today, new Date(2026, 11, 26), new Date(2027, 0, 23), "fr")!;
    expect(cells.map((c) => c.label)).toEqual(["oct.", "nov.", "déc.", "janv.", "févr."]);
    expect(cells.map((c) => c.year)).toEqual([null, null, null, "2027", null]);
    const [oct, , dec, jan, feb] = cells;
    expect(oct!.to > oct!.from).toBe(false);
    expect(dec!.from).toBeCloseTo(25 / 31, 5);
    expect(dec!.to).toBe(1);
    expect(jan!.from).toBe(0);
    expect(jan!.to).toBeCloseTo(23 / 31, 5);
    expect(feb!.to > feb!.from).toBe(false);
  });

  it("shows no year when the strip stays in one year", () => {
    const cells = monthCells(today, new Date(2026, 10, 7), new Date(2026, 10, 28), "en")!;
    expect(cells.map((c) => c.label)).toEqual(["Oct", "Nov", "Dec"]);
    expect(cells.every((c) => c.year === null)).toBe(true);
  });

  it("starts just before the window when it is far away", () => {
    const cells = monthCells(today, new Date(2027, 5, 1), new Date(2027, 6, 15), "en")!;
    expect(cells.map((c) => c.label)).toEqual(["May", "Jun", "Jul", "Aug"]);
  });

  it("gives up on a window longer than eight months", () => {
    expect(monthCells(today, new Date(2027, 0, 1), new Date(2028, 0, 1), "en")).toBeNull();
  });
});
