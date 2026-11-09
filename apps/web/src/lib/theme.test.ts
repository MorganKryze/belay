import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, isDark, LAUNCH_BACKGROUND, readTheme, setTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("dark"), media: q }));
});

describe("theme", () => {
  it.each([
    ["light", true, false],
    ["dark", false, true],
    ["system", true, true],
    ["system", false, false],
  ] as const)("%s with prefersDark=%s → dark=%s", (theme, prefers, expected) => {
    expect(isDark(theme, prefers)).toBe(expected);
  });

  it("defaults to system and ignores garbage in storage", () => {
    expect(readTheme()).toBe("system");
    localStorage.setItem("belay.theme", "neon");
    expect(readTheme()).toBe("system");
  });

  it("colours the browser bar with the paper of each theme", () => {
    expect(LAUNCH_BACKGROUND).toEqual({ light: "#F3F5F5", dark: "#10151A" });
  });

  it("persists and applies the choice", () => {
    setTheme("dark");
    expect(readTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("a chosen theme colours the browser bar in both schemes, and system gives each scheme its own colour", () => {
    document.head.innerHTML =
      '<meta name="theme-color" content="#F3F5F5" media="(prefers-color-scheme: light)" />' +
      '<meta name="theme-color" content="#10151A" media="(prefers-color-scheme: dark)" />';
    const colours = () =>
      [...document.querySelectorAll('meta[name="theme-color"]')].map((m) =>
        m.getAttribute("content"),
      );
    applyTheme("dark");
    expect(colours()).toEqual(["#10151A", "#10151A"]);
    applyTheme("light");
    expect(colours()).toEqual(["#F3F5F5", "#F3F5F5"]);
    applyTheme("system");
    expect(colours()).toEqual(["#F3F5F5", "#10151A"]);
  });

  // The script that runs before the bundle repeats the colours; it must paint the same ones.
  it("the first-paint script colours the browser bar as the app does", () => {
    const script = readFileSync(resolve(__dirname, "../../public/theme-init.js"), "utf8");
    const colours = (theme: "light" | "dark") => {
      localStorage.setItem("belay.theme", theme);
      document.head.innerHTML =
        '<meta name="theme-color" media="(prefers-color-scheme: light)" />' +
        '<meta name="theme-color" media="(prefers-color-scheme: dark)" />';
      new Function(script)();
      return [...document.querySelectorAll('meta[name="theme-color"]')].map((m) =>
        m.getAttribute("content"),
      );
    };
    expect(colours("light")).toEqual([LAUNCH_BACKGROUND.light, LAUNCH_BACKGROUND.light]);
    expect(colours("dark")).toEqual([LAUNCH_BACKGROUND.dark, LAUNCH_BACKGROUND.dark]);
  });
});
