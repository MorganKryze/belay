import { describe, expect, it } from "vitest";
import { lastAverageBox, placeNames } from "./chart";

// A plot running from 26 to 286.
const bounds = { left: 26, right: 286 };
// "Break" is 5 characters: 33.5 units at 6.7 a character.
const name = (id: string, x: number, label = "Break") => ({ id, x, label });

describe("placeNames", () => {
  it("a name sits at the bottom when it clears the names before it", () => {
    const placed = placeNames([name("a", 40), name("b", 120)], bounds, []);
    expect(placed).toEqual([
      { id: "a", level: "bottom", x0: 44, x1: 77.5, anchor: "start" },
      { id: "b", level: "bottom", x0: 124, x1: 157.5, anchor: "start" },
    ]);
  });

  it("a name that would overlap an earlier one goes to the strip above the plot", () => {
    // The first name ends at 77.5; the second would start at 79, less than 6 units past it.
    const placed = placeNames([name("a", 40), name("b", 75)], bounds, []);
    expect(placed.map((p) => p.level)).toEqual(["bottom", "top"]);
    expect(placed[1]).toMatchObject({ x0: 79, x1: 112.5, anchor: "start" });
  });

  it("a name that fits neither is left out", () => {
    const placed = placeNames([name("a", 40), name("b", 50), name("c", 60)], bounds, []);
    expect(placed.map((p) => p.level)).toEqual(["bottom", "top", null]);
  });

  it("near the right edge a name ends at its line", () => {
    // Past right - 60 = 226, the name is written on its line's left, ending 4 units before it.
    const [late] = placeNames([name("a", 250)], bounds, []);
    expect(late).toEqual({ id: "a", level: "bottom", x0: 212.5, x1: 246, anchor: "end" });
    const [early] = placeNames([name("a", 226)], bounds, []);
    expect(early).toMatchObject({ anchor: "start", x0: 230 });
  });

  it("a raised name never covers the band's label", () => {
    const band = [{ x0: 90, x1: 170 }];
    // The second name overlaps the first at the bottom and the band label in the strip.
    const placed = placeNames([name("a", 40), name("b", 75)], bounds, band);
    expect(placed.map((p) => p.level)).toEqual(["bottom", null]);
    // Clear of the label by 6 units, it is raised.
    const clear = placeNames([name("a", 40), name("b", 50)], bounds, [{ x0: 95.5, x1: 170 }]);
    expect(clear.map((p) => p.level)).toEqual(["bottom", "top"]);
  });
});

describe("lastAverageBox", () => {
  it("reserves the last average's width when its text reaches the strip above the plot", () => {
    expect(lastAverageBox(200, 22, "105.4", 20)).toEqual({ x0: 207, x1: 207 + 5 * 6.7 });
  });

  it("reserves nothing when the last average sits lower in the plot", () => {
    expect(lastAverageBox(200, 60, "79.8", 20)).toBeNull();
  });
});
