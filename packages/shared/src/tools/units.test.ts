import { describe, expect, it } from "vitest";
import { WEIGHING_RANGE_KG, isWeighingKg } from "../body/weighings";
import { EQUIPMENT } from "../exercises/muscles";
import { isSetKg } from "../training/workout";
import {
  INCREMENT_LB,
  KG_PER_LB,
  incrementIn,
  kgFromLoad,
  kgFromWeighing,
  kgToLb,
  lbToKg,
  loadFromKg,
  rangeIn,
  stepIn,
  weighingFromKg,
} from "./units";

describe("pounds and kilograms", () => {
  it("a pound is 0.45359237 kg", () => {
    expect(KG_PER_LB).toBe(0.45359237);
    expect(lbToKg(1)).toBe(0.45359237);
    expect(kgToLb(0.45359237)).toBe(1);
    expect(lbToKg(kgToLb(100))).toBeCloseTo(100, 10);
  });
});

describe("a set's load", () => {
  it("every whole pound from 0 to 1102 reads back unchanged and lands on the set grid", () => {
    for (let lb = 0; lb <= 1102; lb++) {
      const kg = kgFromLoad(lb, "lb");
      expect(isSetKg(kg), `${lb} lb → ${kg} kg`).toBe(true);
      expect(loadFromKg(kg, "lb"), `${lb} lb → ${kg} kg`).toBe(lb);
    }
  });

  it("a typed 137.5 lb load is logged as 138 lb", () => {
    const kg = kgFromLoad(137.5, "lb");
    expect(kg).toBe(62.5);
    expect(loadFromKg(kg, "lb")).toBe(138);
  });

  it("kg loads pass through untouched", () => {
    expect(kgFromLoad(82.5, "kg")).toBe(82.5);
    expect(kgFromLoad(82.3, "kg")).toBe(82.3);
    expect(loadFromKg(82.5, "kg")).toBe(82.5);
  });
});

describe("a weigh-in", () => {
  it("a weigh-in typed on the quarter pound reads back exactly and passes isWeighingKg", () => {
    for (let quarters = 177; quarters <= 3527; quarters++) {
      const lb = quarters / 4;
      const kg = kgFromWeighing(lb, "lb");
      expect(isWeighingKg(kg), `${lb} lb → ${kg} kg`).toBe(true);
      expect(weighingFromKg(kg, "lb"), `${lb} lb → ${kg} kg`).toBe(lb);
    }
  });

  it("each quarter-pound step lands on a different stored 0.1 kg", () => {
    for (let quarters = 177; quarters < 3527; quarters++) {
      const kg = kgFromWeighing(quarters / 4, "lb");
      expect(kgFromWeighing((quarters + 1) / 4, "lb"), `${quarters / 4} lb`).not.toBe(kg);
    }
  });

  it("kg weigh-ins pass through untouched", () => {
    expect(kgFromWeighing(80.4, "kg")).toBe(80.4);
    expect(weighingFromKg(80.4, "kg")).toBe(80.4);
    expect(weighingFromKg(80.4, "lb")).toBe(177.25); // 177.25 lb
    expect(weighingFromKg(80.2, "lb")).toBe(176.75); // 176.81 lb
  });

  it("rangeIn rounds the weigh-in bounds inward to 44.25 and 881.75", () => {
    expect(rangeIn(WEIGHING_RANGE_KG, "lb", 0.25)).toEqual({ min: 44.25, max: 881.75 });
    expect(rangeIn({ min: 30, max: 300 }, "lb", 1)).toEqual({ min: 67, max: 661 });
    expect(rangeIn(WEIGHING_RANGE_KG, "kg", 0.1)).toEqual({ min: 20, max: 400 });
  });
});

describe("steps and increments", () => {
  it("stepIn maps 0.1, 0.25, 0.5, 1, 2.5, 5", () => {
    expect([0.1, 0.25, 0.5, 1, 2.5, 5].map((s) => stepIn(s, "lb"))).toEqual([
      0.25, 0.5, 1, 2, 5, 10,
    ]);
    expect(stepIn(2.5, "kg")).toBe(2.5);
  });

  it("each equipment has a whole-pound increment", () => {
    for (const equipment of EQUIPMENT) {
      expect(Number.isInteger(INCREMENT_LB[equipment]), equipment).toBe(true);
      expect(INCREMENT_LB[equipment]).toBeGreaterThan(0);
    }
    expect(INCREMENT_LB).toEqual({
      barbell: 5,
      dumbbell: 5,
      machine: 10,
      cable: 5,
      bodyweight: 5,
      other: 2,
    });
    expect(incrementIn({ equipment: "machine", incrementKg: 5 }, "lb")).toBe(10);
    expect(incrementIn({ equipment: "machine", incrementKg: 5 }, "kg")).toBe(5);
  });
});
