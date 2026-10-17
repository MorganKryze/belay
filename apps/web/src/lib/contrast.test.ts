import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { contrastRatio, flatten, readTokens } from "./contrast";

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
  ["primary-ink", "surface", 4.5],
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
  // Inside the creatine band, the dots and the line (its label: primary-ink, above).
  ["chart-dot", "primary-soft", 3],
  ["chart-line", "primary-soft", 3],
  // The body map's primary tone, on the card and on the track behind a thumbnail.
  ["muscle-primary", "surface", 3],
  ["muscle-primary", "track", 3],
  ["primary-ink", "tab-pill", 4.5], // the active tab's label on its pill
  ["destructive", "surface", 4.5],
  ["primary-ink", "track", 3], // the error edge on a field's fill
  ["toast-icon", "foreground", 3], // the session bar's timer and the toast's error icon
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

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)(
    "%s theme keeps the body map's secondary tone apart from the primary",
    (_, tokens) => {
      const ratio = contrastRatio(tokens["muscle-primary"]!, tokens["muscle-secondary"]!);
      expect(ratio, ratio.toFixed(2)).toBeGreaterThanOrEqual(2);
    },
  );

  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme reads every tab on the frosted bar", (_, tokens) => {
    const bar = flatten(tokens.glass!, tokens.background!);
    for (const [fg, min] of [
      ["muted-foreground", 4.5],
      ["foreground", 4.5],
      ["primary-ink", 3],
    ] as const) {
      const ratio = contrastRatio(tokens[fg]!, bar);
      expect(ratio, `${fg} on glass: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    }
  });

  // The destructive button tints itself with its own red: 10 % at rest and 20 % on hover in the
  // light theme, 20 % and 30 % in the dark one. Its 14 px label needs 4.5:1 on every tint, on the
  // page and on a card.
  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme reads the destructive label on its own tint", (_, tokens) => {
    const red = tokens.destructive!;
    const channels = [1, 3, 5].map((i) => parseInt(red.slice(i, i + 2), 16)).join(", ");
    for (const under of ["background", "surface"] as const) {
      for (const alpha of [0.1, 0.2, 0.3]) {
        const tint = flatten(`rgba(${channels}, ${alpha})`, tokens[under]!);
        const ratio = contrastRatio(red, tint);
        expect(
          ratio,
          `destructive on ${alpha} of itself over ${under}: ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Read from the button itself, so a hover fill drawn with an alpha (bg-primary/80) is laid on
  // the page or a card before it is measured: the label needs 4.5:1 on what the eye sees.
  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("%s theme reads the primary button's label on its hover fill", (_, tokens) => {
    const hover = /(?:^|\s)hover:bg-([a-z-]+)(?:\/(\d+))?(?:\s|$)/.exec(
      buttonVariants({ variant: "primary" }),
    );
    expect(hover, "the primary button has a hover fill").not.toBeNull();
    const [, token, percent] = hover!;
    const fill = tokens[token!]!;
    const channels = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)).join(", ");
    for (const under of ["background", "surface"] as const) {
      const seen = percent
        ? flatten(`rgba(${channels}, ${Number(percent) / 100})`, tokens[under]!)
        : fill;
      const ratio = contrastRatio(tokens["primary-foreground"]!, seen);
      expect(
        ratio,
        `primary-foreground on hover ${token}${percent ? `/${percent}` : ""} over ${under}: ${ratio.toFixed(2)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("lays an rgba colour on an opaque one", () => {
    expect(flatten("rgba(0, 0, 0, 0.5)", "#ffffff")).toBe("#808080");
    expect(flatten("rgba(255, 255, 255, 1)", "#000000")).toBe("#ffffff");
    expect(readTokens("\n:root {\n  --a: rgba(1, 2, 3, 0.5);\n}", ":root")).toEqual({
      a: "rgba(1, 2, 3, 0.5)",
    });
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
