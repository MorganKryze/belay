import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCREENS, startupFile } from "../../startup-images";
import { MOUNTAIN_D, RING_D, TILE_MARK } from "@/lib/mark";
import { decodePng } from "./png";

const web = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(web, p), "utf8");
// Width and height from a PNG's IHDR chunk.
const pngSize = (p: string) => {
  const b = readFileSync(resolve(web, p));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
// Bounds of an SVG path made of M, L and semicircle A commands: each arc's extreme points lie on
// its centre (the chord's midpoint) plus or minus its radius.
const pathBounds = (d: string) => {
  const xs: number[] = [];
  const ys: number[] = [];
  let x = 0;
  let y = 0;
  for (const [, cmd, args] of d.matchAll(/([MLAZ])([^MLAZ]*)/g)) {
    const n = args!
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (cmd === "A") {
      const [r, , , , , nx, ny] = n as [number, number, number, number, number, number, number];
      const cx = (x + nx) / 2;
      const cy = (y + ny) / 2;
      xs.push(cx - r, cx + r);
      ys.push(cy - r, cy + r);
      [x, y] = [nx, ny];
    } else if (cmd !== "Z") [x, y] = [n[0]!, n[1]!];
    xs.push(x);
    ys.push(y);
  }
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};
// Bounding box (left, top, right, bottom) of the pixels that pass `ink` in an 8-bit RGB or RGBA,
// non-interlaced PNG.
const inkBox = (p: string, ink: (r: number, g: number, b: number, a: number) => boolean) => {
  const { width: w, height: h, rgba } = decodePng(readFileSync(resolve(web, p)));
  let [top, bottom, left, right] = [h, -1, w, -1];
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const at = (j * w + i) * 4;
      if (ink(rgba[at]!, rgba[at + 1]!, rgba[at + 2]!, rgba[at + 3]!)) {
        [top, bottom] = [Math.min(top, j), Math.max(bottom, j)];
        [left, right] = [Math.min(left, i), Math.max(right, i)];
      }
    }
  return [left, top, right, bottom] as const;
};
// Width, height and top row of the blue mark's bounding box: the pixels past halfway from the
// paper to the blue, #1F4E8C on #F3F5F5 or #8DB6EE on #10151A, where blue leads red by 54 or more.
const markBox = (p: string) => {
  const [left, top, right, bottom] = inkBox(p, (r, _, b) => b - r > 54);
  return [right - left + 1, bottom - top + 1, top] as const;
};
// The launch word's box: the pixels past halfway from the paper to the ink, #12181C on #F3F5F5
// or #EEF2F3 on #10151A, the blue mark aside.
const wordBox = (p: string, theme: "light" | "dark") =>
  inkBox(p, (r, g, b) =>
    theme === "light" ? Math.max(r, g, b) < 137 : Math.min(r, g, b) > 127 && b - r < 30,
  );
// The launch screen's markup, before the app's root.
const launchMarkup = () => {
  const html = read("index.html");
  return html.slice(html.indexOf("<body>"), html.indexOf('<div id="root">'));
};
const MARK = "M86 160L86 266A120 120 0 0 0 326 266";

describe("app shell identity", () => {
  it("keeps the icon sources as the mark on a paper tile, colour light and colour dark", () => {
    for (const [file, paper, ring, mountain] of [
      ["icons/app-icon.svg", "#F3F5F5", "#12181C", "#1F4E8C"],
      ["icons/app-icon-dark.svg", "#10151A", "#F3F5F5", "#8DB6EE"],
    ] as const) {
      const src = read(file);
      expect(src).toContain(`<rect width="100" height="100" fill="${paper}"/>`);
      expect(src).toContain(`<path d="${RING_D}" stroke="${ring}"/>`);
      expect(src).toContain(`<path d="${MOUNTAIN_D}" stroke="${mountain}"/>`);
      expect(src).not.toContain("prefers-color-scheme");
    }
  });

  it("uses one file as normal and maskable icon", () => {
    expect(existsSync(resolve(web, "public/maskable-icon-512x512.png"))).toBe(false);
    const config = read("vite.config.ts");
    expect(config).not.toContain("maskable-icon");
    expect(config).toContain('background_color: "#F3F5F5"');
    expect(config).toContain('theme_color: "#F3F5F5"');
  });

  it("paints a launch screen before the JavaScript, with a theme colour per scheme", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/0f172a/i);
    expect(html).toContain(
      '<meta name="theme-color" content="#F3F5F5" media="(prefers-color-scheme: light)" />',
    );
    expect(html).toContain(
      '<meta name="theme-color" content="#10151A" media="(prefers-color-scheme: dark)" />',
    );
    // Outside #root: React's first render would take it away before the account is known.
    const launch = html.slice(html.indexOf("<body>"), html.indexOf('<div id="root">'));
    expect(launch).toContain(MARK);
    expect(launch).toContain("Belay");
  });

  it("keeps the mark inside the charter's icon geometry", () => {
    const { offset, scale } = TILE_MARK;
    for (const file of ["icons/app-icon.svg", "icons/app-icon-dark.svg"])
      expect(read(file)).toContain(
        `<g transform="translate(${offset} ${offset}) scale(${scale})">`,
      );
  });

  it("ships every icon at its size", () => {
    expect(pngSize("public/pwa-64x64.png")).toEqual([64, 64]);
    expect(pngSize("public/pwa-192x192.png")).toEqual([192, 192]);
    expect(pngSize("public/pwa-512x512.png")).toEqual([512, 512]);
    expect(pngSize("public/apple-touch-icon-180x180.png")).toEqual([180, 180]);
    const ico = readFileSync(resolve(web, "public/favicon.ico"));
    const sizes = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ico[6 + i * 16]);
    expect(sizes.sort((a, b) => a! - b!)).toEqual([16, 32, 48]);
  });

  it("declares a light and a dark launch image for every listed iPhone", () => {
    expect(SCREENS).toHaveLength(11);
    for (const screen of SCREENS)
      for (const theme of ["light", "dark"] as const) {
        const file = `public/${startupFile(theme, screen)}`;
        expect(existsSync(resolve(web, file)), file).toBe(true);
        expect(pngSize(file)).toEqual([screen.width * screen.ratio, screen.height * screen.ratio]);
      }
  });
  it("frames the whole mark on the launch screen", () => {
    const launch = launchMarkup().split("</svg>")[0]!;
    const box = /viewBox="([\d. ]+)"/.exec(launch);
    expect(box).not.toBeNull();
    const [vx, vy, vw, vh] = box![1]!.split(" ").map(Number) as [number, number, number, number];
    for (const [, d] of launch.matchAll(/ d="([^"]+)"/g)) {
      const [x0, y0, x1, y1] = pathBounds(d!);
      expect(x0).toBeGreaterThanOrEqual(vx);
      expect(y0).toBeGreaterThanOrEqual(vy);
      expect(x1).toBeLessThanOrEqual(vx + vw);
      expect(y1).toBeLessThanOrEqual(vy + vh);
    }
  });

  it("paints the whole mark in the launch images", () => {
    // The full mark is 340 by 260; a crop to the old 232 high frame flattens both arcs.
    for (const theme of ["light", "dark"] as const) {
      const [w, h] = markBox(`public/${startupFile(theme, SCREENS[4]!)}`);
      expect(h / w).toBeCloseTo(260 / 340, 1);
    }
  });

  it("places the mark where the launch screen shows it under the status bar", () => {
    // On an iPhone 1170x2532 in standalone mode the HTML launch screen starts below the 47 px
    // status bar (measured on the phone). Centring the mark, the gap and the word in the rest,
    // lifted by 6 % of the screen, puts the mark's top at 1000 device px. The image must match it.
    for (const theme of ["light", "dark"] as const) {
      const [, , top] = markBox(`public/${startupFile(theme, SCREENS[4]!)}`);
      expect(Math.abs(top - 1000)).toBeLessThanOrEqual(9);
    }
  });

  it("draws the launch word as a named image, with no text left to a font", () => {
    // The fonts are not loaded at the first paint: a text node would show in the system font
    // while the launch image shows the display face, and the word would jump at the handover.
    const launch = launchMarkup().replace(/<!--[\s\S]*?-->/g, "");
    expect(launch.replace(/<[^>]*>/g, "").trim()).toBe("");
    expect(launch).toMatch(/<svg[^>]* role="img" aria-label="Belay"/);
  });

  it("keeps the launch word's place and size in the launch images", () => {
    // The word as the launch screen draws it, in device px on the 1170x2532 iPhone: its outline
    // inks x 85 to 3488 and y 153 to 1083 of a 3491 by 1088 box drawn 80.29 px wide at 3x, so 235
    // by 64, 47 px under the mark (12 px of gap plus the box's top), and 3 px right of the centre
    // since its left bearing is wider than its right.
    for (const theme of ["light", "dark"] as const) {
      const file = `public/${startupFile(theme, SCREENS[4]!)}`;
      const [left, top, right, bottom] = wordBox(file, theme);
      const [, markHeight, markTop] = markBox(file);
      expect(Math.abs(right - left + 1 - 235)).toBeLessThanOrEqual(3);
      expect(Math.abs(bottom - top + 1 - 64)).toBeLessThanOrEqual(3);
      expect(Math.abs(top - (markTop + markHeight) - 47)).toBeLessThanOrEqual(3);
      expect(Math.abs((left + right + 1) / 2 - (1170 / 2 + 3))).toBeLessThanOrEqual(3);
    }
  });
});
