import { describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/button";
import { EACH_SET, SETS } from "@/test/token-sets";
import { contrastRatio, flatten, readTokens, resolveTokens } from "./contrast";

// Every text and graphic pair of the palette is in tokens.test.ts; these are the ones laid on a
// translucent or tinted fill.
const { light } = SETS;

describe("design tokens", () => {
  it.each(EACH_SET)(
    "%s theme keeps the body map's secondary tone apart from the primary",
    (_, tokens) => {
      const ratio = contrastRatio(tokens["muscle-primary"]!, tokens["muscle-secondary"]!);
      expect(ratio, ratio.toFixed(2)).toBeGreaterThanOrEqual(2);
    },
  );

  it.each(EACH_SET)("%s theme reads every tab on the frosted bar", (_, tokens) => {
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

  // The destructive button shows a press with the shared tint of the ink (6 % light, 7 % dark),
  // no red of its own: its 14 px label needs 4.5:1 on that tint, on the page and on a card.
  it.each(EACH_SET)("%s theme reads the destructive label on its pressed tint", (_, tokens) => {
    expect(buttonVariants({ variant: "destructive" })).toContain("active:bg-press-tint");
    const ink = tokens.foreground!;
    const channels = [1, 3, 5].map((i) => parseInt(ink.slice(i, i + 2), 16)).join(", ");
    for (const under of ["background", "surface"] as const) {
      for (const alpha of [0, 0.06, 0.07]) {
        const tint = flatten(`rgba(${channels}, ${alpha})`, tokens[under]!);
        const ratio = contrastRatio(tokens.destructive!, tint);
        expect(
          ratio,
          `destructive on ${alpha} of the ink over ${under}: ${ratio.toFixed(2)}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // Read from the button itself: its label against each fill it takes at rest, on hover and on
  // press. A fill drawn with an alpha (bg-mark/80) is laid on the page or a card before it is
  // measured: the label needs 4.5:1 on what the eye sees.
  it.each(EACH_SET)(
    "%s theme reads the primary button's label on every fill it takes",
    (_, tokens) => {
      const classes = buttonVariants({ variant: "primary" });
      // text-button is the type style, not a colour: only the classes naming a token count.
      const labels = [...classes.matchAll(/(?:^|\s)text-([a-z-]+)(?=\s|$)/g)]
        .map(([, token]) => token!)
        .filter((token) => token in tokens);
      expect(labels, "the primary button has one label colour").toHaveLength(1);
      const label = labels[0]!;
      const fills = [
        ...classes.matchAll(/(?:^|\s)(?:(?:hover|active):)?bg-(?!clip-)([a-z-]+)(?:\/(\d+))?/g),
      ];
      expect(fills.length, "the primary button has a fill").toBeGreaterThan(0);
      for (const [, token, percent] of fills) {
        const fill = tokens[token!]!;
        const channels = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16)).join(", ");
        for (const under of ["background", "surface"] as const) {
          const seen = percent
            ? flatten(`rgba(${channels}, ${Number(percent) / 100})`, tokens[under]!)
            : fill;
          const ratio = contrastRatio(tokens[label]!, seen);
          expect(
            ratio,
            `${label} on ${token}${percent ? `/${percent}` : ""} over ${under}: ${ratio.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  // The loading mark settles at 80 % opacity: what the eye sees is the primary laid on the page.
  it.each(EACH_SET)(
    "%s theme keeps the loader mark at 80 % at 3:1 on the background",
    (_, tokens) => {
      const primary = tokens.primary!;
      const channels = [1, 3, 5].map((i) => parseInt(primary.slice(i, i + 2), 16)).join(", ");
      const mark = flatten(`rgba(${channels}, 0.8)`, tokens.background!);
      const ratio = contrastRatio(mark, tokens.background!);
      expect(ratio, `loader mark: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
    },
  );

  it("lays an rgba colour on an opaque one", () => {
    expect(flatten("rgba(0, 0, 0, 0.5)", "#ffffff")).toBe("#808080");
    expect(flatten("rgba(255, 255, 255, 1)", "#000000")).toBe("#ffffff");
    expect(readTokens("\n:root {\n  --a: rgba(1, 2, 3, 0.5);\n}", ":root")).toEqual({
      a: "rgba(1, 2, 3, 0.5)",
    });
  });

  it("follows an alias to the colour it ends at, and refuses one that ends nowhere", () => {
    expect(resolveTokens({ a: "var(--b)", b: "var(--c)", c: "#123456" })).toEqual({
      a: "#123456",
      b: "#123456",
      c: "#123456",
    });
    expect(() => resolveTokens({ a: "var(--b)", b: "var(--a)" })).toThrow("does not resolve");
    expect(() => resolveTokens({ a: "var(--missing)" })).toThrow("--missing does not resolve");
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
