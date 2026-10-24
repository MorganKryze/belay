import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bodyWeight,
  bodyWeightText,
  loadNumber,
  parseLoad,
  readWeightUnit,
  setWeightUnit,
  weightStepper,
} from "./units";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("the weight unit", () => {
  it("the unit is kg until lb is chosen, and holds for the visit when storage refuses it", () => {
    expect(readWeightUnit()).toBe("kg");
    localStorage.setItem("belay.weightUnit", "stone");
    expect(readWeightUnit()).toBe("kg");
    setWeightUnit("lb");
    expect(localStorage.getItem("belay.weightUnit")).toBe("lb");
    expect(readWeightUnit()).toBe("lb");
    setWeightUnit("kg");
    expect(readWeightUnit()).toBe("kg");

    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    setWeightUnit("lb");
    expect(readWeightUnit()).toBe("lb");
  });

  it("the formatters follow the unit chosen, read at each call", () => {
    expect(bodyWeightText(80.38, "fr")).toBe("80,4\u00a0kg");
    expect(loadNumber(82.5, "fr")).toBe("82,5");
    setWeightUnit("lb");
    expect(bodyWeightText(80.38, "fr")).toBe("177,2\u00a0lb");
    expect(loadNumber(82.5, "fr")).toBe("182");
  });
});

describe("body weight", () => {
  it("bodyWeightText says 177,2 lb in French and 177.2 lb in English, the unit kept on its line", () => {
    expect(bodyWeightText(80.38, "fr", "lb")).toBe("177,2\u00a0lb");
    expect(bodyWeightText(80.38, "en", "lb")).toBe("177.2\u00a0lb");
    expect(bodyWeightText(80, "fr", "kg")).toBe("80,0\u00a0kg");
  });

  it("is written to the tenth, with its decimal", () => {
    expect(bodyWeight(80.4, "fr", "kg")).toBe("80,4");
    expect(bodyWeight(80.38, "fr", "lb")).toBe("177,2");
    expect(bodyWeight(90.7, "en", "lb")).toBe("200.0");
  });
});

describe("a load", () => {
  it("is shown in kg to two decimals and in whole pounds", () => {
    expect(loadNumber(82.5, "fr", "kg")).toBe("82,5");
    expect(loadNumber(1.25, "en", "kg")).toBe("1.25");
    expect(loadNumber(62.5, "fr", "lb")).toBe("138");
    expect(loadNumber(500, "fr", "lb")).toBe("1102");
    expect(loadNumber(500, "en", "lb", true)).toBe("1,102");
  });

  it("parseLoad refuses text and 1103 lb", () => {
    expect(parseLoad("abc", "lb")).toBeNull();
    expect(parseLoad("", "lb")).toBeNull();
    expect(parseLoad("1103", "lb")).toBeNull();
    expect(parseLoad("1102", "lb")).toBe(499.75);
    expect(parseLoad("137,5", "lb")).toBe(62.5);
    expect(parseLoad("82,5", "kg")).toBe(82.5);
    expect(parseLoad("82,3", "kg")).toBeNull();
    expect(parseLoad("501", "kg")).toBeNull();
  });

  it("parseLoad gives back the prefilled kg when its shown text is left as it is", () => {
    // 100 kg is shown "220"; saved untouched it stays 100, not 99.75.
    expect(parseLoad("220", "lb", 100)).toBe(100);
    for (let q = 0; q <= 2000; q++) {
      expect(parseLoad(loadNumber(q / 4, "en", "lb"), "lb", q / 4)).toBe(q / 4);
    }
    // Edited text is converted as usual.
    expect(parseLoad("221", "lb", 100)).toBe(100.25);
  });
});

describe("a weight stepper", () => {
  it("weightStepper gives 67 to 661 lb at step 1 for the tools' 30 to 300 kg at 0.5", () => {
    const lb = weightStepper(80, { min: 30, max: 300 }, 0.5, "lb");
    expect(lb).toMatchObject({ unit: "lb", value: 176, min: 67, max: 661, step: 1 });
    expect(lb.toKg(176)).toBe(80);
    expect(lb.toKg(177)).toBeCloseTo(80.286, 3);
    const kg = weightStepper(80, { min: 30, max: 300 }, 0.5, "kg");
    expect(kg).toMatchObject({ unit: "kg", value: 80, min: 30, max: 300, step: 0.5 });
    expect(kg.toKg(80.5)).toBe(80.5);
  });
});
