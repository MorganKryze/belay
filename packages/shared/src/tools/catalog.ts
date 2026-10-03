// The toolkit's shared vocabulary. Kept tiny on purpose: the router imports it into the initial
// bundle, so nothing heavy (formulas, science texts) may live here.
export const TOOL_IDS = [
  "one-rep-max",
  "plates",
  "warmup",
  "energy",
  "protein",
  "projection",
  "bmi",
  "body-fat",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const isToolId = (value: string): value is ToolId =>
  (TOOL_IDS as readonly string[]).includes(value);

export const TOOL_GROUPS = [
  { id: "strength", tools: ["one-rep-max", "plates", "warmup"] },
  { id: "energy", tools: ["energy", "protein", "projection"] },
  { id: "body", tools: ["bmi", "body-fat"] },
] as const satisfies readonly { id: string; tools: readonly ToolId[] }[];

// Which published equation to use. Named after the formula, not after the person.
export type Formula = "female" | "male";

// Position of a value against published thresholds. Descriptive only: never a judgement.
export type Band = "below" | "reference" | "above" | "well-above";
