import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  DEFAULT_EQUIPMENT,
  deriveBodyFatPct,
  parseInputs,
  readToolState,
  resolveEquipment,
  TOOL_STATE_KEY,
  type ToolState,
  ToolStateSchema,
  writeToolState,
} from "./tool-storage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("tool storage", () => {
  it("starts from defaults", () => {
    expect(readToolState()).toEqual({
      lastInputs: {},
      equipment: DEFAULT_EQUIPMENT,
      formula: "female",
      bodyFatReference: "standard",
    });
  });

  it("round-trips what it writes", () => {
    const state = { ...readToolState(), formula: "male" as const, heightCm: 178 };
    writeToolState(state);
    expect(readToolState()).toEqual(state);
  });

  it("falls back to defaults on unreadable JSON or a non-object", () => {
    localStorage.setItem(TOOL_STATE_KEY, "{not json");
    expect(readToolState().formula).toBe("female");
    localStorage.setItem(TOOL_STATE_KEY, "42");
    expect(readToolState().lastInputs).toEqual({});
  });

  it("replaces only the invalid fields", () => {
    localStorage.setItem(
      TOOL_STATE_KEY,
      JSON.stringify({ formula: "robot", heightCm: 178, weightKg: -3, equipment: { preset: "x" } }),
    );
    const s = readToolState();
    expect(s.formula).toBe("female");
    expect(s.heightCm).toBe(178);
    expect(s.weightKg).toBeUndefined();
    expect(s.equipment).toEqual(DEFAULT_EQUIPMENT);
  });

  it("never throws when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(readToolState()).toEqual(ToolStateSchema.parse({}));
    expect(() => writeToolState(readToolState())).not.toThrow();
  });

  it("parses a tool's inputs with per-field defaults", () => {
    const schema = z.object({
      loadKg: z.number().min(1).catch(100),
      reps: z.number().int().catch(5),
    });
    expect(parseInputs(schema, undefined)).toEqual({ loadKg: 100, reps: 5 });
    expect(parseInputs(schema, { loadKg: 80, reps: "x" })).toEqual({ loadKg: 80, reps: 5 });
    expect(parseInputs(schema, "garbage")).toEqual({ loadKg: 100, reps: 5 });
  });

  it("resolves presets to their fixed sets and custom to the saved one", () => {
    expect(resolveEquipment({ preset: "gym", bar: 15, plates: [1] })).toEqual({
      barKg: 20,
      platesKg: [20, 10, 5, 2.5],
    });
    expect(resolveEquipment({ preset: "custom", bar: 15, plates: [10, 1.25] })).toEqual({
      barKg: 15,
      platesKg: [10, 1.25],
    });
  });

  it("drops stored body values outside the shared tool bounds", () => {
    localStorage.setItem(TOOL_STATE_KEY, JSON.stringify({ heightCm: 119, weightKg: 301 }));
    const s = readToolState();
    expect(s.heightCm).toBeUndefined();
    expect(s.weightKg).toBeUndefined();
  });
});

describe("deriveBodyFatPct", () => {
  const female: ToolState = {
    ...ToolStateSchema.parse({}),
    heightCm: 172,
    lastInputs: { "body-fat": { neckCm: 33, waistCm: 76, hipCm: 101 } },
  };
  it("returns the rounded estimate when every measurement is entered", () => {
    expect(deriveBodyFatPct(female)).toBe(29);
  });
  it("follows the shared formula and height", () => {
    expect(deriveBodyFatPct({ ...female, formula: "male" as const })).toBe(
      deriveBodyFatPct({ ...female, formula: "male" as const, heightCm: 172 }),
    );
    expect(deriveBodyFatPct({ ...female, heightCm: 190 })).not.toBe(29);
  });
  it("needs hips only for the female formula", () => {
    const noHips = { ...female, lastInputs: { "body-fat": { neckCm: 33, waistCm: 76 } } };
    expect(deriveBodyFatPct(noHips)).toBeUndefined();
    expect(deriveBodyFatPct({ ...noHips, formula: "male" as const })).toBeGreaterThan(0);
  });
  it("is undefined without a height, without girths, or outside 2 to 75 %", () => {
    expect(deriveBodyFatPct({ ...female, heightCm: undefined })).toBeUndefined();
    expect(deriveBodyFatPct(ToolStateSchema.parse({ heightCm: 172 }))).toBeUndefined();
    const huge = { ...female, heightCm: 230, formula: "male" as const };
    huge.lastInputs = { "body-fat": { neckCm: 80, waistCm: 81 } };
    expect(deriveBodyFatPct(huge)).toBeUndefined();
  });
});
