import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCREENS, startupFile } from "../../startup-images";

const web = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(web, p), "utf8");
// Width and height from a PNG's IHDR chunk.
const pngSize = (p: string) => {
  const b = readFileSync(resolve(web, p));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
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
});
