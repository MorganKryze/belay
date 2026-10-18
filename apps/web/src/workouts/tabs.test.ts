import { describe, expect, it } from "vitest";
import { parseSee, seeList, toggleSee } from "./tabs";

describe("the sessions open on the Programme, in the address", () => {
  it("keeps known codes in the program's order, once each, and drops the rest", () => {
    expect(parseSee("C,B,B,x")).toBe("B,C");
    expect(parseSee("A")).toBe("A");
    expect(parseSee("")).toBeUndefined();
    expect(parseSee("x,Z")).toBeUndefined();
    expect(parseSee(42)).toBeUndefined();
    expect(parseSee(undefined)).toBeUndefined();
  });

  it("reads the list back", () => {
    expect(seeList("B,C")).toEqual(["B", "C"]);
    expect(seeList(undefined)).toEqual([]);
  });

  it("opens and folds a session", () => {
    expect(toggleSee("B", "C", true)).toBe("B,C");
    expect(toggleSee("C", "A", true)).toBe("A,C");
    expect(toggleSee(undefined, "B", true)).toBe("B");
    expect(toggleSee("B,C", "B", false)).toBe("C");
    expect(toggleSee("B", "B", false)).toBeUndefined();
  });
});
