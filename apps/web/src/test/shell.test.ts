import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const web = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(web, p), "utf8");
const MARK = "M86 160L86 266A120 120 0 0 0 326 266";

describe("app shell identity", () => {
  it("shows the orange mark as the tab icon", () => {
    const logo = read("public/logo.svg");
    expect(logo).toContain(MARK);
    expect(logo).toContain('fill="#C2410C"');
    expect(logo).toContain("#FB923C");
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
    const root = html.slice(html.indexOf('<div id="root">'), html.indexOf("</body>"));
    expect(root).toContain(MARK);
    expect(root).toContain("Belay");
  });
});
