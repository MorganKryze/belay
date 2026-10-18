import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SCREENS, startupFile } from "../../startup-images";

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
// Width and height of the orange mark's bounding box in an 8-bit RGB, non-interlaced PNG.
const markBox = (p: string) => {
  const b = readFileSync(resolve(web, p));
  const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
  expect([b[24], b[25], b[28]]).toEqual([8, 2, 0]);
  const chunks: Buffer[] = [];
  for (let at = 8; at < b.length;) {
    const len = b.readUInt32BE(at);
    if (b.toString("ascii", at + 4, at + 8) === "IDAT")
      chunks.push(b.subarray(at + 8, at + 8 + len));
    at += len + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const row = w * 3;
  const px = Buffer.alloc(row * h);
  let [top, bottom, left, right] = [h, -1, w, -1];
  for (let j = 0; j < h; j++) {
    const filter = raw[j * (row + 1)];
    for (let i = 0; i < row; i++) {
      const v = raw[j * (row + 1) + 1 + i]!;
      const a = i >= 3 ? px[j * row + i - 3]! : 0;
      const up = j > 0 ? px[(j - 1) * row + i]! : 0;
      const c = i >= 3 && j > 0 ? px[(j - 1) * row + i - 3]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = (a + up) >> 1;
      else if (filter === 4) {
        const base = a + up - c;
        const [pa, pb, pc] = [Math.abs(base - a), Math.abs(base - up), Math.abs(base - c)];
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      px[j * row + i] = (v + pred) & 255;
    }
    for (let i = 0; i < w; i++) {
      const [r, , bl] = [px[j * row + i * 3]!, 0, px[j * row + i * 3 + 2]!];
      if (r > 150 && bl < 100) {
        [top, bottom] = [Math.min(top, j), Math.max(bottom, j)];
        [left, right] = [Math.min(left, i), Math.max(right, i)];
      }
    }
  }
  return [right - left + 1, bottom - top + 1] as const;
};
const MARK = "M86 160L86 266A120 120 0 0 0 326 266";

describe("app shell identity", () => {
  it("shows the orange mark as the tab icon", () => {
    const logo = read("public/logo.svg");
    expect(logo).toContain(MARK);
    expect(logo).toContain('fill="#C2410C"');
    expect(logo).toContain("#FB923C");
    // Cropped to the mark's 340 px width: it fills a 16 px tab instead of 10.6 px of it.
    expect(logo).toContain('viewBox="86 86 340 340"');
  });

  it("keeps the icon source with a chalk background", () => {
    const src = read("icons/app-icon.svg");
    expect(src).toContain(MARK);
    expect(src).toContain("#FAFAF7");
  });

  it("uses one file as normal and maskable icon", () => {
    expect(existsSync(resolve(web, "public/maskable-icon-512x512.png"))).toBe(false);
    const config = read("vite.config.ts");
    expect(config).not.toContain("maskable-icon");
    expect(config).toContain('background_color: "#FAFAF7"');
    expect(config).toContain('theme_color: "#FAFAF7"');
  });

  it("paints a launch screen before the JavaScript, with a theme colour per scheme", () => {
    const html = read("index.html");
    expect(html).not.toMatch(/0f172a/i);
    expect(html).toContain(
      '<meta name="theme-color" content="#FAFAF7" media="(prefers-color-scheme: light)" />',
    );
    expect(html).toContain(
      '<meta name="theme-color" content="#151412" media="(prefers-color-scheme: dark)" />',
    );
    // Outside #root: React's first render would take it away before the account is known.
    const launch = html.slice(html.indexOf("<body>"), html.indexOf('<div id="root">'));
    expect(launch).toContain(MARK);
    expect(launch).toContain("Belay");
  });

  it("keeps the mark inside the charter's icon geometry", () => {
    const scale = /scale\(([\d.]+)\)/.exec(read("icons/app-icon.svg"));
    expect(scale).not.toBeNull();
    const s = Number(scale![1]);
    // 198 px is the farthest point of the master path from the centre (256, 256): the outer edge
    // of the round cap at (106, 160) and (406, 352), 178.1 px away plus its 20 px radius. It must
    // stay inside the maskable safe circle, 40 % of 512.
    expect(198 * s).toBeLessThanOrEqual(204.8);
    expect(340 * s).toBeLessThanOrEqual(290);
    expect((512 - 340 * s) / 2).toBeGreaterThanOrEqual((340 * s) / 4);
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
    const html = read("index.html");
    const launch = html.slice(html.indexOf("<body>"), html.indexOf('<div id="root">'));
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
});
