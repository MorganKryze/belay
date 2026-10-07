import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, readTokens } from "./contrast";

// Read from disk: the stylesheet is the single source of the tokens.
// A path, not new URL(): under jsdom, URL is not the class node:fs accepts.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");
const light = readTokens(css, ":root");
const dark = { ...light, ...readTokens(css, ".dark") };

// [foreground, background, minimum]: 4.5 for text, 3 for focus rings, borders and marks.
const PAIRS = [
  ["foreground", "background", 4.5],
  ["foreground", "surface", 4.5],
  ["foreground", "track", 4.5],
  ["foreground", "primary-soft", 4.5],
  ["foreground", "reference", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "surface", 4.5],
  ["muted-foreground", "track", 4.5],
  ["muted-foreground", "primary-soft", 4.5],
  ["primary", "background", 4.5],
  ["primary", "surface", 4.5],
  ["primary", "primary-soft", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["primary-ink", "primary-soft", 4.5],
  ["reference-ink", "reference", 4.5],
  ["background", "foreground", 4.5], // the toast
  ["toast-action", "foreground", 4.5],
  ["input", "surface", 3],
  ["input", "background", 3],
  ["ring", "background", 3],
  ["ring", "surface", 3],
  ["primary", "track", 3],
  ["chart-dot", "surface", 3],
  ["chart-dot", "background", 3],
  ["chart-line", "surface", 3],
  ["chart-line", "background", 3],
] as const;

describe("design tokens", () => {
  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme meets AA on every pair", (_, tokens) => {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrastRatio(tokens[fg]!, tokens[bg]!);
      expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    }
  });

  it("writes every plate's weight legibly on its colour", () => {
    const plates = [
      ["plate-ink-light", "plate-red"],
      ["plate-ink-light", "plate-blue"],
      ["plate-ink-light", "plate-green"],
      ["plate-ink-dark", "plate-yellow"],
      ["plate-ink-dark", "plate-white"],
      ["plate-ink-dark", "plate-grey"],
    ] as const;
    for (const [fg, bg] of plates) {
      expect(contrastRatio(light[fg]!, light[bg]!), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("computes the WCAG ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
});
