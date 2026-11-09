import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCREENS, startupFile } from "../../startup-images";
import {
  MARK_SHIFT,
  MARK_VIEWBOX,
  MOUNTAIN_D,
  PEAK_D,
  RING_D,
  STROKE,
  TILE_MARK,
} from "@/lib/mark";
import { decodePng } from "./png";

const web = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(web, p), "utf8");
// Width and height from a PNG's IHDR chunk.
const pngSize = (p: string) => {
  const b = readFileSync(resolve(web, p));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
// The mark's ink on its grid: the ring's circle (centre from its chord and radius) and the
// mountain's foot, each widened by half the stroke for the round caps and joins.
const markInk = () => {
  const n = [...RING_D.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
  // M x0 y0 A r r rotation large sweep x1 y1.
  const [x0, y0, r, x1] = [n[0]!, n[1]!, n[2]!, n[7]!];
  const cx = (x0 + x1) / 2;
  const cy = y0 - Math.sqrt(r * r - ((x1 - x0) / 2) ** 2) + MARK_SHIFT.y;
  const half = STROKE / 2;
  return {
    left: cx - r - half,
    top: cy - r - half,
    right: cx + r + half,
    bottom: y0 + MARK_SHIFT.y + half,
  };
};
// The rows of a launch image that hold anything but the paper, split where a blank row parts
// them: the first band is the mark, the second the logotype. Each comes back as its box.
const bands = (p: string) => {
  const { width: w, height: h, rgba } = decodePng(readFileSync(resolve(web, p)));
  const [pr, pg, pb] = [rgba[0]!, rgba[1]!, rgba[2]!];
  const found: [number, number, number, number][] = [];
  let open = false;
  for (let j = 0; j < h; j++) {
    let [left, right] = [w, -1];
    for (let i = 0; i < w; i++) {
      const at = (j * w + i) * 4;
      // Past halfway from the paper to the lightest ink the launch draws.
      const far =
        Math.abs(rgba[at]! - pr) + Math.abs(rgba[at + 1]! - pg) + Math.abs(rgba[at + 2]! - pb);
      if (far > 120) [left, right] = [Math.min(left, i), Math.max(right, i)];
    }
    if (right < 0) {
      open = false;
      continue;
    }
    const band = found.at(-1);
    if (open && band) {
      band[0] = Math.min(band[0], left);
      band[2] = Math.max(band[2], right);
      band[3] = j;
    } else found.push([left, j, right, j]);
    open = true;
  }
  return found;
};
// Width, height and top row of the mark in a launch image.
const markBox = (p: string) => {
  const [left, top, right, bottom] = bands(p)[0]!;
  return [right - left + 1, bottom - top + 1, top] as const;
};
// The logotype's box in a launch image, below the mark.
const wordBox = (p: string) => bands(p)[1]!;
// The launch screen's markup, before the app's root.
const launchMarkup = () => {
  const html = read("index.html");
  return html.slice(html.indexOf("<body>"), html.indexOf('<div id="root">'));
};
// The logotype's letters as the icons hold them, every outline drawn on the launch.
const LOGOTYPE = [...read("icons/logotype-light.svg").matchAll(/ d="([^"]+)"/g)].map((m) => m[1]!);

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
    expect(launch).toContain(`d="${RING_D}"`);
    expect(launch).toContain(`d="${MOUNTAIN_D}"`);
    expect(LOGOTYPE).toHaveLength(5);
    expect(LOGOTYPE).toContain(PEAK_D);
    for (const d of LOGOTYPE) expect(launch).toContain(`d="${d}"`);
    expect(launch).toContain('aria-label="Belay"');
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
    const mark = launchMarkup().split("</svg>")[0]!;
    expect(mark).toContain(`viewBox="${MARK_VIEWBOX}"`);
    expect(mark).toContain(`transform="translate(${MARK_SHIFT.x} ${MARK_SHIFT.y})"`);
    expect(mark).toContain(`stroke-width="${STROKE}"`);
    const { left, top, right, bottom } = markInk();
    expect(Math.min(left, top)).toBeGreaterThanOrEqual(0);
    expect(Math.max(right, bottom)).toBeLessThanOrEqual(100);
  });

  it("paints the whole mark in the launch images", () => {
    // A crop of the frame would flatten the ring's top or cut its caps.
    const { left, top, right, bottom } = markInk();
    for (const theme of ["light", "dark"] as const) {
      const [w, h] = markBox(`public/${startupFile(theme, SCREENS[4]!)}`);
      expect(h / w).toBeCloseTo((bottom - top) / (right - left), 1);
    }
  });

  it("places the mark where the launch screen shows it under the status bar", () => {
    // On an iPhone 1170x2532 in standalone mode the HTML launch screen starts below the 47 px
    // status bar (measured on the phone). The 112 px mark, the 12 px gap and the 16.1 px logotype
    // centred in the rest and lifted by 6 % of the screen put the mark's frame at 324.8 px, and
    // its ink 8 px lower: 999 device px. The image must match it.
    for (const theme of ["light", "dark"] as const) {
      const [, , top] = markBox(`public/${startupFile(theme, SCREENS[4]!)}`);
      expect(Math.abs(top - 999)).toBeLessThanOrEqual(9);
    }
  });

  it("draws the launch word as a named image, with no text left to a font", () => {
    // The fonts are not loaded at the first paint: a text node would show in the system font
    // while the launch image shows the display face, and the word would jump at the handover.
    const launch = launchMarkup().replace(/<!--[\s\S]*?-->/g, "");
    expect(launch.replace(/<[^>]*>/g, "").trim()).toBe("");
    expect(launch).toMatch(/<svg[^>]*\srole="img"\s+aria-label="Belay"/);
  });

  it("keeps the logotype's place and size in the launch images", () => {
    // The logotype as the launch screen draws it, in device px on the 1170x2532 iPhone: its
    // outlines fill a 872 by 140.6 box drawn 100 px wide at 3x, so 300 by 48, centred, and 85 px
    // under the mark's ink (the frame's 14.7 units below the feet, then the 12 px gap).
    for (const theme of ["light", "dark"] as const) {
      const file = `public/${startupFile(theme, SCREENS[4]!)}`;
      const [left, top, right, bottom] = wordBox(file);
      const [, markHeight, markTop] = markBox(file);
      expect(Math.abs(right - left + 1 - 300)).toBeLessThanOrEqual(3);
      expect(Math.abs(bottom - top + 1 - 48)).toBeLessThanOrEqual(3);
      expect(Math.abs(top - (markTop + markHeight) - 85)).toBeLessThanOrEqual(4);
      expect(Math.abs((left + right + 1) / 2 - 1170 / 2)).toBeLessThanOrEqual(3);
    }
  });
});
