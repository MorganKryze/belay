import { LAUNCH_BACKGROUND } from "../../startup-images";

export type Theme = "light" | "dark" | "system";
const KEY = "belay.theme";
const THEMES: readonly string[] = ["light", "dark", "system"];

export const isDark = (theme: Theme, prefersDark: boolean) =>
  theme === "dark" || (theme === "system" && prefersDark);

export function readTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v && THEMES.includes(v) ? (v as Theme) : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme) {
  const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", isDark(theme, prefersDark));
  // Each scheme has its own meta: a chosen theme gives both its colour, system keeps one each.
  for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
    meta.setAttribute(
      "content",
      LAUNCH_BACKGROUND[
        isDark(theme, meta.getAttribute("media")?.includes("dark") ?? false) ? "dark" : "light"
      ],
    );
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
  applyTheme(theme);
}
