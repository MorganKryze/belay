import { HEIGHT_RANGE_CM, WEIGHT_RANGE_KG } from "@belay/shared/tools/bounds";
import { NAVY_RANGE_PCT } from "@belay/shared/tools/body-fat";
import type { ToolId } from "@belay/shared/tools/catalog";
import { PLATE_PRESETS } from "@belay/shared/tools/plates";
import { useCallback, useMemo, useState } from "react";
import { z } from "zod";

// Everything the tools remember lives in this one key, on this device only. Nothing is sent.
export const TOOL_STATE_KEY = "belay.tools.v1";

const plateKg = z.number().positive().max(100);
export const EquipmentSchema = z.object({
  preset: z.enum(["competition", "gym", "custom"]),
  // The custom set. The two presets are read-only and come from PLATE_PRESETS.
  bar: plateKg,
  plates: z.array(plateKg).max(30),
});
export type Equipment = z.infer<typeof EquipmentSchema>;
export const DEFAULT_EQUIPMENT: Equipment = {
  preset: "gym",
  bar: PLATE_PRESETS.gym.barKg,
  plates: [...PLATE_PRESETS.gym.platesKg],
};

// Each field falls back on its own: a corrupted formula does not wipe a saved height.
export const ToolStateSchema = z.object({
  lastInputs: z.record(z.string(), z.unknown()).catch({}),
  equipment: EquipmentSchema.catch(DEFAULT_EQUIPMENT),
  formula: z.enum(["female", "male"]).catch("female"),
  bodyFatReference: z.enum(["standard", "asian"]).catch("standard"),
  bodyFatPct: z
    .number()
    .min(NAVY_RANGE_PCT.min)
    .max(NAVY_RANGE_PCT.max)
    .optional()
    .catch(undefined),
  heightCm: z
    .number()
    .min(HEIGHT_RANGE_CM.min)
    .max(HEIGHT_RANGE_CM.max)
    .optional()
    .catch(undefined),
  weightKg: z
    .number()
    .min(WEIGHT_RANGE_KG.min)
    .max(WEIGHT_RANGE_KG.max)
    .optional()
    .catch(undefined),
});
export type ToolState = z.infer<typeof ToolStateSchema>;
const defaults = (): ToolState => ToolStateSchema.parse({});

export function readToolState(): ToolState {
  try {
    const raw = localStorage.getItem(TOOL_STATE_KEY);
    if (raw === null) return defaults();
    const parsed = ToolStateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaults();
  } catch {
    // No storage (private mode, blocked) or unreadable JSON: the tools still work, unremembered.
    return defaults();
  }
}

export function writeToolState(state: ToolState): void {
  try {
    localStorage.setItem(TOOL_STATE_KEY, JSON.stringify(state));
  } catch {
    // Same as above: this visit's values are simply not kept.
  }
}

export function resolveEquipment(e: Equipment): { barKg: number; platesKg: readonly number[] } {
  return e.preset === "custom" ? { barKg: e.bar, platesKg: e.plates } : PLATE_PRESETS[e.preset];
}

// Parses a tool's own inputs; every field of `schema` carries a .catch(), so {} gives defaults.
export function parseInputs<S extends z.ZodType<Record<string, unknown>>>(
  schema: S,
  raw: unknown,
): z.output<S> {
  const parsed = schema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}

// One state per page: every field a page touches goes through the same `update`, so two writes
// in a row never overwrite each other with a stale copy.
export function useTool<S extends z.ZodType<Record<string, unknown>>>(toolId: ToolId, schema: S) {
  const [state, setState] = useState(readToolState);
  const update = useCallback((change: (prev: ToolState) => ToolState) => {
    setState((prev) => {
      const next = change(prev);
      writeToolState(next); // idempotent, so StrictMode's double call is harmless
      return next;
    });
  }, []);
  const inputs = useMemo(
    () => parseInputs(schema, state.lastInputs[toolId]),
    [schema, state.lastInputs, toolId],
  );
  const setInputs = useCallback(
    (patch: Partial<z.output<S>>) =>
      update((prev) => ({
        ...prev,
        lastInputs: {
          ...prev.lastInputs,
          [toolId]: { ...parseInputs(schema, prev.lastInputs[toolId]), ...patch },
        },
      })),
    [schema, toolId, update],
  );
  return { state, update, inputs, setInputs };
}
