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
  TILE_MARK,
} from "@/lib/mark";
import { decodePng } from "./png";

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

// The drawn lockup sets the mark in a 64 px box beside 46 px capitals (cap height 0.688 em)
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

// The frames of an ICO, each as RGBA rows: PNG frames, or 32-bit BMP frames stored bottom-up.
const icoFrames = (b: Buffer) =>
  Array.from({ length: b.readUInt16LE(4) }, (_, i) => {
    const size = b[6 + i * 16] || 256;
    const length = b.readUInt32LE(6 + i * 16 + 8);
    const at = b.readUInt32LE(6 + i * 16 + 12);
    const data = b.subarray(at, at + length);
    if (data.readUInt32BE(0) === 0x89504e47) return { size, ...decodePng(data) };
    expect(data.readUInt16LE(14)).toBe(32);
    const header = data.readUInt32LE(0);
    const rgba = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const from = header + ((size - 1 - y) * size + x) * 4;
        const to = (y * size + x) * 4;
        rgba[to] = data[from + 2]!;
        rgba[to + 1] = data[from + 1]!;
        rgba[to + 2] = data[from]!;
        rgba[to + 3] = data[from + 3]!;
      }
    return { size, width: size, height: size, rgba };
  });

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const distance = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
// How far a pixel is from the paper, composited on it, as a share of the ink's distance:
// 0 is paper, 1 is a full ink stroke.
const darkness = (rgba: Buffer, width: number, x: number, y: number) => {
  const at = (y * width + x) * 4;
  const alpha = rgba[at + 3]! / 255;
  const paper = hex(PAPER);
  const rgb = [0, 1, 2].map((c) => rgba[at + c]! * alpha + paper[c]! * (1 - alpha));
  return distance(rgb, paper) / distance(hex(INK), paper);
};

describe("the mark's sources", () => {
  it("draws every version from the mark's own ring and mountain, round-capped", () => {
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

  it("keeps the mark's own numbers", () => {
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

  it("keeps the drawn lockup's proportions", () => {
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

describe("the web's marks", () => {
  it("shows the mark in colour light as the tab icon, colour dark in the dark scheme", () => {
    const logo = read("public/logo.svg");
    expect(logo).toContain(`<path d="${RING_D}" stroke="${INK}"/>`);
    expect(logo).toContain(`<path d="${MOUNTAIN_D}" stroke="${BLUE}"/>`);
    expect(logo).toMatch(new RegExp(`prefers-color-scheme: dark[^<]*${PAPER}[^<]*${LIGHT_BLUE}`));
  });

  it("keeps the ring, its opening and the summit apart in the 16 px favicon", () => {
    const frames = icoFrames(readFileSync(resolve(web, "public/favicon.ico")));
    expect(frames.map((f) => f.size).sort((a, b) => a - b)).toEqual([16, 32, 48]);
    const { rgba } = frames.find((f) => f.size === 16)!;
    // The favicon's tile sets the mark at 84 % with an 8 % margin.
    const px = (u: number) => ((8 + 0.84 * u) * 16) / 100;
    const ringCentre = 78.8 - Math.sqrt(37 ** 2 - 21.4 ** 2) + MARK_SHIFT.y;
    const column = Math.floor(px(56 + MARK_SHIFT.x));
    const d = Array.from({ length: 16 }, (_, y) => darkness(rgba, 16, column, y));
    const ringTop = px(ringCentre - 37);
    const summit = px(44 + MARK_SHIFT.y);
    const rows = (from: number, to: number) => d.slice(Math.round(from), Math.round(to) + 1);
    const ringPeak = Math.max(...rows(ringTop - 1, ringTop + 1));
    const summitPeak = Math.max(...rows(summit - 1, summit + 1));
    const between = Math.min(...rows(ringTop + 1, summit - 1));
    expect(between).toBeLessThan(Math.min(ringPeak, summitPeak) / 2);
    // A stroke's width is the ink it lays across one line of pixels.
    const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
    expect(sum(rows(ringTop - 2, ringTop + 1.5))).toBeGreaterThanOrEqual(1.5);
    const row = Math.floor(px(ringCentre));
    const across = Array.from({ length: 16 }, (_, x) => darkness(rgba, 16, x, row));
    expect(sum(across.slice(0, 6))).toBeGreaterThanOrEqual(1.5);
    expect(sum(across.slice(10))).toBeGreaterThanOrEqual(1.5);
  });

  it("ships the installed app's icons with the mark inside the maskable circle", () => {
    for (const [file, side] of [
      ["pwa-64x64.png", 64],
      ["pwa-192x192.png", 192],
      ["pwa-512x512.png", 512],
      ["apple-touch-icon-180x180.png", 180],
    ] as const) {
      const { width, height, rgba } = decodePng(readFileSync(resolve(web, `public/${file}`)));
      expect([width, height]).toEqual([side, side]);
      expect(darkness(rgba, side, 0, 0)).toBeLessThan(0.02);
      let inked = 0;
      for (let y = 0; y < side; y++)
        for (let x = 0; x < side; x++) {
          if (darkness(rgba, side, x, y) < 0.1) continue;
          inked++;
          const r = Math.hypot(x + 0.5 - side / 2, y + 0.5 - side / 2);
          expect(r, `${file} ${x},${y}`).toBeLessThanOrEqual(0.4 * side);
        }
      expect(inked).toBeGreaterThan(0);
    }
  });

  it("sizes the iPhone tile's mark for the home screen at 180 px", () => {
    expect(TILE_MARK.scale).toBeCloseTo(0.66, 2);
    expect(TILE_MARK.offset).toBeCloseTo((100 - 100 * TILE_MARK.scale) / 2, 5);
    const toPx = (u: number) => u * TILE_MARK.scale * 1.8;
    expect(toPx(STROKE)).toBeGreaterThanOrEqual(8);
    // The shoulder is the mountain's second point, the dip after it its third.
    const [, shoulder, dip] = points(MOUNTAIN_D);
    expect(toPx(dip![1] - shoulder![1])).toBeGreaterThanOrEqual(4);
  });
});
