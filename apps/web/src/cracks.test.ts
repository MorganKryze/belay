import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crackLength, fissures } from "../scripts/gen-cracks.mjs";
import { MOUNTAIN_D, RING_D, STROKE } from "@/lib/mark";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("./cracks.css");
const index = read("./index.css");

// The ink each theme's text is set in, as index.css declares it first.
const ink = (block: RegExp) => block.exec(index)![1]!.toLowerCase();
const INK = {
  light: ink(/:root \{[^}]*?--foreground: (#[0-9a-f]{6});/i),
  dark: ink(/\.dark \{[^}]*?--foreground: (#[0-9a-f]{6});/i),
};
const OPACITY = { light: ["0.3", "0.42"], dark: ["0.26", "0.36"] };

// The rules a stylesheet holds for one selector or media query, braces matched.
function block(source: string, head: string): string | null {
  const at = source.indexOf(head);
  if (at < 0) return null;
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(at, i + 1);
  }
  return null;
}

describe.each(["light", "dark"] as const)("the %s cracks", (theme) => {
  const svg = read(`./assets/cracks-${theme}.svg`);

  it("weigh 6 kB at most", () => {
    expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(6144);
  });

  it("hold only paths, in two groups, in the theme's ink at the drawing's opacities", () => {
    const tags = [...svg.matchAll(/<(\w+)/g)].map((m) => m[1]);
    expect(new Set(tags)).toEqual(new Set(["svg", "g", "path"]));
    const groups = [...svg.matchAll(/<g ([^>]*)>/g)].map((m) => m[1]!);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain(`stroke="${INK[theme]}"`);
    expect(groups[0]).toContain(`opacity="${OPACITY[theme][0]}"`);
    expect(groups[1]).toContain(`opacity="${OPACITY[theme][1]}"`);
    expect(groups[1]).toContain(`stroke="${INK[theme]}"`);
    expect(groups[1]).toContain('fill="none"');
  });

  it("carry the mark, ring and mountain in the theme's ink, where the hook stood", () => {
    const mark = svg.split("</g>")[1]!;
    expect([...mark.matchAll(/ d="([^"]+)"/g)].map((m) => m[1])).toEqual([RING_D, MOUNTAIN_D]);
    expect(mark).toContain(`stroke-width="${STROKE}"`);
    // The hook's top-left corner was at 191.3, 43.4 and it was 12 px wide: the mark's ink takes
    // the same corner and width, its frame drawn from the ink's corner on the grid.
    const [, x, y, scale, ix, iy] =
      /translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\) translate\(-([\d.]+) -([\d.]+)\)/.exec(
        mark,
      )!;
    expect([Number(x), Number(y)]).toEqual([191.3, 43.4]);
    // Ink from 7.5 to 92.5 across, the ring's circle and its round caps.
    expect(Number(ix)).toBeCloseTo(50 - 37 - STROKE / 2, 1);
    expect(Number(iy)).toBeGreaterThan(5);
    expect(Number(scale) * (37 * 2 + STROKE)).toBeCloseTo(12, 1);
  });

  it("are the generator's output, a quarter to a half longer than the first drawing", () => {
    const ratio = crackLength(svg) / crackLength(fissures(theme, 1));
    expect(ratio).toBeGreaterThanOrEqual(1.25);
    expect(ratio).toBeLessThanOrEqual(1.5);
  });

  it("stay in the right 60 % of the corner", () => {
    const cracks = svg.split("</g>")[0]!;
    const xs = [...cracks.matchAll(/[ML](-?[\d.]+) /g)].map((m) => Number(m[1]));
    expect(xs.length).toBeGreaterThan(100);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(240 * 0.4);
    const [, hx] = /translate\((-?[\d.]+) /.exec(svg.split("</g>")[1]!)!;
    expect(Number(hx)).toBeGreaterThanOrEqual(240 * 0.4);
  });
});

describe("the cracks layer", () => {
  it("is off under more contrast, reduced transparency and forced colours, with solid bars", () => {
    for (const head of [
      "(prefers-contrast: more)",
      "(prefers-reduced-transparency: reduce)",
      "(forced-colors: active)",
      'html[data-contrast="more"]',
    ]) {
      const rules = block(css, head);
      expect(rules, head).not.toBeNull();
      expect(rules, head).toMatch(/::before[^{]*\{[^}]*content: none/);
      expect(rules, head).toMatch(/--glass: var\(--surface\)/);
    }
  });

  it("has nothing for the launch screen, which covers it", () => {
    expect(css).not.toContain(".launch");
  });

  it("is imported by the page's stylesheet", () => {
    expect(index).toContain('@import "./cracks.css";');
  });
});
