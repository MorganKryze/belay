import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Values as one line: Prettier may wrap a long linear() over several.
const oneLine = (value: string) =>
  value.trim().replace(/\s+/g, " ").replace(/\( /g, "(").replace(/,? \)/g, ")");

// The stylesheet is the single source of the tokens; these pin the charter's scales.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

function declared(pattern: RegExp): Record<string, string> {
  return Object.fromEntries([...css.matchAll(pattern)].map((m) => [m[1]!, oneLine(m[2]!)]));
}

describe("design scales", () => {
  it("defines exactly the charter's durations", () => {
    expect(declared(/--(dur-[\w-]+):\s*([^;]+);/g)).toEqual({
      "dur-press": "90ms",
      "dur-fast": "140ms",
      "dur-check": "180ms",
      "dur-release": "200ms",
      "dur-base": "220ms",
      "dur-sheet-out": "300ms",
      "dur-pill": "300ms",
      "dur-overlay-in": "350ms",
      "dur-overlay-out": "300ms",
      "dur-cover-in": "450ms",
      "dur-cover-out": "260ms",
      "dur-slide-reduced": "300ms",
      "dur-veil-reduced": "200ms",
      "dur-pop": "380ms",
      "dur-untint": "250ms",
      "dur-push": "420ms",
      "dur-sheet-in": "500ms",
      "dur-pulse": "600ms",
      "dur-reduced": "120ms",
      "dur-breathe": "1200ms",
      "dur-launch-out": "240ms",
    });
  });

  it("declares no delay token: the launch mark breathes from its first frame", () => {
    expect(declared(/--(delay-[\w-]+):\s*([^;]+);/g)).toEqual({});
  });

  it("defines the eight curves with the charter's values", () => {
    expect(declared(/--((?:ease|spring)-[\w-]+):\s*([^;]+);/g)).toEqual({
      "ease-out": "cubic-bezier(0.2, 0.8, 0.2, 1)",
      "ease-nav": "cubic-bezier(0.32, 0.72, 0, 1)",
      "ease-sheet": "cubic-bezier(0.4, 0.2, 0, 1)",
      "ease-exit": "cubic-bezier(0.4, 0, 1, 1)",
      "ease-pill": "linear(0, 0.2 10%, 0.6 25%, 0.9 40%, 1.03 55%, 1.01 70%, 1)",
      "spring-nav":
        "linear(0, 0.151 8.3%, 0.435 16.7%, 0.646 25%, 0.788 33.3%, 0.876 41.7%, 0.93 50%, 0.959 58.3%, 0.977 66.7%, 0.986 75%, 0.993 83.3%, 1)",
      "spring-pop-in": "linear(0, 0.5 18%, 0.9 35%, 1.06 52%, 1.02 70%, 1)",
      "ease-breathe": "cubic-bezier(0.42, 0, 0.58, 1)",
    });
  });

  it("defines the type scale from big figure to tab label", () => {
    const text = declared(/--(text-[\w-]+):\s*([^;]+);/g);
    const expected: Record<string, [string, string, string | undefined, string]> = {
      figure: ["50px", "1", "-0.035em", "700"],
      "figure-md": ["34px", "1", "-0.03em", "700"],
      "title-lg": ["30px", "1.15", "-0.02em", "700"],
      "title-session": ["22px", "1.25", "-0.015em", "700"],
      "title-card": ["19px", "1.3", "-0.01em", "650"],
      "title-compact": ["17px", "1.3", undefined, "650"],
      button: ["16px", "1.25", undefined, "650"],
      body: ["15px", "1.45", undefined, "400"],
      secondary: ["13px", "1.35", undefined, "400"],
      section: ["13px", "1.35", undefined, "600"],
      tab: ["11.5px", "1.2", undefined, "600"],
    };
    for (const [name, [size, lh, ls, weight]] of Object.entries(expected)) {
      expect(text[`text-${name}`], name).toBe(size);
      expect(text[`text-${name}--line-height`], name).toBe(lh);
      expect(text[`text-${name}--letter-spacing`], name).toBe(ls);
      expect(text[`text-${name}--font-weight`], name).toBe(weight);
    }
  });

  it("defines the radius scale 10, 12, 14, 16, 18, 24, 30 and round (and the 8 px icon square)", () => {
    const radius = declared(/--(radius-[\w-]+):\s*(\d[^;]*);/g);
    expect(radius).toEqual({
      "radius-icon": "8px",
      "radius-chip": "10px",
      "radius-control": "12px",
      "radius-field": "14px",
      "radius-group": "16px",
      "radius-card": "18px",
      "radius-bar": "24px",
      "radius-sheet": "30px",
      "radius-round": "9999px",
    });
  });

  it("keeps the 4 px spacing step", () => {
    expect(declared(/--(spacing):\s*([^;]+);/g)).toEqual({ spacing: "0.25rem" });
  });
});
