import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MARK_SHIFT,
  MARK_VIEWBOX,
  MOUNTAIN_D,
  PEAK_D,
  RING_D,
  STROKE,
  STROKE_SMALL,
} from "@/lib/mark";

const web = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(web, p), "utf8");

const INK = "#12181C";
const BLUE = "#1F4E8C";
const PAPER = "#F3F5F5";
const LIGHT_BLUE = "#8DB6EE";
// Ring then mountain, or letters then peak, per version.
const COLOURS = {
  light: [INK, BLUE],
  dark: [PAPER, LIGHT_BLUE],
  ink: [INK, INK],
  white: ["#FFFFFF", "#FFFFFF"],
} as const;

// The validated lockup set the mark in a 64 px box beside 46 px capitals (cap height 0.688 em)
// with an 18 px gap; the files keep those proportions to the cap height.
const CAP = 46 * 0.688;
const MARK_PER_CAP = 64 / CAP;
const GAP_PER_CAP = 18 / CAP;

// The points of an outline written with absolute M, L, Q and Z commands.
const points = (d: string) => {
  const n = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  return Array.from({ length: n.length / 2 }, (_, i) => [n[2 * i]!, n[2 * i + 1]!] as const);
};
const paths = (svg: string) => [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1];

// The logotype's letters (every path but the peak) span exactly the cap height: B, E, L and Y
// are flat at the top and on the baseline.
const capHeight = (svg: string) => {
  const ys = paths(svg)
    .filter((p) => attr(p, "d") !== PEAK_D)
    .flatMap((p) => points(attr(p, "d")!).map(([, y]) => y));
  return Math.max(...ys) - Math.min(...ys);
};

describe("the mark's sources", () => {
  it("draws every version from the board's ring and mountain, round-capped", () => {
    for (const [name, size] of [
      ["mark", STROKE],
      ["mark-small", STROKE_SMALL],
    ] as const)
      for (const [version, [ring, mountain]] of Object.entries(COLOURS)) {
        const svg = read(`icons/${name}-${version}.svg`);
        expect(svg).toContain(`viewBox="${MARK_VIEWBOX}"`);
        expect(svg).toContain(`translate(${MARK_SHIFT.x} ${MARK_SHIFT.y})`);
        expect(svg).toContain(`stroke-width="${size}"`);
        expect(svg).toContain('stroke-linecap="round"');
        expect(svg).toContain('stroke-linejoin="round"');
        expect(svg).toContain(`<path d="${RING_D}" stroke="${ring}"/>`);
        expect(svg).toContain(`<path d="${MOUNTAIN_D}" stroke="${mountain}"/>`);
      }
  });

  it("keeps the board's numbers", () => {
    expect(MARK_VIEWBOX).toBe("0 0 100 100");
    expect(RING_D).toBe("M28.6 78.8 A37 37 0 1 1 71.4 78.8");
    expect(MOUNTAIN_D).toBe("M28.6 78.8 L39 58 L45 64 L56 44 L71.4 78.8");
    expect([STROKE, STROKE_SMALL]).toEqual([11, 14]);
    expect(PEAK_D).toBe("M0 137.6 L31 71 L45 83 L95 -3 L186 137.6 L138 137.6 L95 72.6 L50 137.6 Z");
  });

  it("draws the logotype as outlines, the peak at the capitals' height", () => {
    for (const version of ["light", "dark", "ink"] as const) {
      const svg = read(`icons/logotype-${version}.svg`);
      expect(svg).not.toMatch(/<text|font-family|@font-face|\bfont:|\.woff|\.ttf/);
      const [letters, peakColour] = COLOURS[version];
      const peak = paths(svg).filter((p) => attr(p, "d") === PEAK_D);
      expect(peak).toHaveLength(1);
      expect(attr(peak[0]!, "fill")).toBe(peakColour);
      const scale = /scale\(([\d.]+)\)/.exec(attr(peak[0]!, "transform") ?? "");
      expect(scale).not.toBeNull();
      // The peak's box is 137.6 high: scaled to the capitals, its base sits on their baseline.
      expect(Math.abs((Number(scale![1]) * 137.6) / capHeight(svg) - 1)).toBeLessThan(0.01);
      for (const p of paths(svg).filter((t) => attr(t, "d") !== PEAK_D))
        expect(attr(p, "fill")).toBe(letters);
    }
  });

  it("sets the lockup with the board's proportions", () => {
    for (const version of ["light", "dark", "ink"] as const) {
      const svg = read(`icons/lockup-${version}.svg`);
      expect(svg).not.toMatch(/<text|font-family|@font-face|\.woff|\.ttf/);
      const groups = [...svg.matchAll(/<g transform="([^"]*)">/g)].map((m) => m[1]!);
      const mark = /scale\(([\d.]+)\)/.exec(groups[0]!);
      const word = /translate\(([\d.]+) /.exec(groups[1]!);
      expect(mark).not.toBeNull();
      expect(word).not.toBeNull();
      const box = 100 * Number(mark![1]);
      const cap = capHeight(svg);
      expect(Math.abs(box / cap / MARK_PER_CAP - 1)).toBeLessThan(0.02);
      expect(Math.abs((Number(word![1]) - box) / cap / GAP_PER_CAP - 1)).toBeLessThan(0.02);
      const [ring, mountain] = COLOURS[version];
      expect(svg).toContain(`<path d="${RING_D}" stroke="${ring}"/>`);
      expect(svg).toContain(`<path d="${MOUNTAIN_D}" stroke="${mountain}"/>`);
    }
  });
});
