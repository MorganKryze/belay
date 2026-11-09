import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, readTokens } from "@/lib/contrast";
import { EACH_SET, MEDIA_MORE, MORE_DARK, MORE_LIGHT, SETS } from "@/test/token-sets";

// Values as one line: Prettier may wrap a long linear() over several.
const oneLine = (value: string) =>
  value.trim().replace(/\s+/g, " ").replace(/\( /g, "(").replace(/,? \)/g, ")");

// The stylesheet is the single source of the tokens; these pin the charter's scales.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

// The scales as declared, without the reduced-motion block that remaps some of them: from its
// opening line to the first closing brace back at the line start.
const scales = css.replace(/^@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?^\}/m, "");

function declared(pattern: RegExp): Record<string, string> {
  return Object.fromEntries([...scales.matchAll(pattern)].map((m) => [m[1]!, oneLine(m[2]!)]));
}

// The scales text sizes are multiplied by, as declared on the root.
const scaleOf = (name: string): string => {
  const value = new RegExp(`--${name}:\\s*([^;]+);`).exec(scales)?.[1];
  if (value === undefined) throw new Error(`--${name} not declared`);
  return value;
};

// A text size in px with the phone's text size at `ratio` and a 16 px root: the scales resolved
// from their declarations, then the arithmetic CSS would do.
function sizeAt(value: string, ratio = 1): number {
  let expression = value;
  for (let i = 0; i < 3; i++)
    expression = expression.replace(/var\(--(text-scale|title-scale|bar-scale)\)/g, (_, name) =>
      name === "text-scale" ? String(ratio) : `(${scaleOf(name)})`,
    );
  const js = expression
    .replace(/(\d*\.?\d+)rem/g, "($1*16)")
    .replace(/(\d*\.?\d+)px/g, "$1")
    .replace(/\bcalc\(/g, "(")
    .replace(/\b(min|max)\(/g, "Math.$1(");
  if (!/^(?:[\d\s.+\-*/(),]|Math\.min|Math\.max)*$/.test(js))
    throw new Error(`cannot read ${value}`);
  return Math.round((new Function(`return ${js}`)() as number) * 1000) / 1000;
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

  it("defines the type scale from big figure to tab label, each at its size at the default text size", () => {
    const text = declared(/--(text-[\w-]+):\s*([^;]+);/g);
    const expected: Record<string, [number, string, string | undefined, string]> = {
      figure: [50, "1", "-0.035em", "700"],
      "figure-md": [34, "1", "-0.03em", "700"],
      "title-lg": [30, "1.15", "-0.02em", "700"],
      "title-session": [22, "1.25", "-0.015em", "700"],
      "title-card": [19, "1.3", "-0.01em", "650"],
      "title-compact": [17, "1.3", undefined, "650"],
      button: [16, "1.25", undefined, "650"],
      body: [15, "1.45", undefined, "400"],
      secondary: [13, "1.35", undefined, "400"],
      section: [13, "1.35", undefined, "600"],
      tab: [11.5, "1.2", undefined, "600"],
    };
    for (const [name, [size, lh, ls, weight]] of Object.entries(expected)) {
      expect(sizeAt(text[`text-${name}`]!), name).toBe(size);
      expect(text[`text-${name}--line-height`], name).toBe(lh);
      expect(text[`text-${name}--letter-spacing`], name).toBe(ls);
      expect(text[`text-${name}--font-weight`], name).toBe(weight);
    }
  });

  it("keeps every text size where it was at the default text size", () => {
    const sizes = Object.fromEntries(
      Object.entries(declared(/--(text-[\w-]+):\s*([^;]+);/g))
        .filter(([name]) => !name.includes("--") && name !== "text-scale")
        .map(([name, value]) => [name, sizeAt(value)]),
    );
    expect(sizes).toEqual({
      "text-figure": 50,
      "text-figure-lg": 44,
      "text-figure-md": 34,
      "text-title-lg": 30,
      "text-title-session": 22,
      "text-title-card": 19,
      "text-title-compact": 17,
      "text-button": 16,
      "text-body": 15,
      "text-note": 13.5,
      "text-secondary": 13,
      "text-section": 13,
      "text-tab": 11.5,
      "text-label": 11.5,
      "text-caption": 11,
      "text-micro": 10,
      "text-xs": 12,
      "text-sm": 14,
      "text-base": 16,
      "text-lg": 18,
      "text-xl": 20,
      "text-2xl": 24,
      "text-3xl": 30,
      "text-4xl": 36,
      "text-5xl": 48,
      "text-6xl": 60,
      "text-7xl": 72,
      "text-8xl": 96,
      "text-9xl": 128,
    });
  });

  // AX3 on the iPhone: body text from 17 to 40 px.
  it("damps titles to x1.54 and caps the bar's labels at x1.3 at a large text size", () => {
    const text = declared(/--(text-[\w-]+):\s*([^;]+);/g);
    expect(sizeAt(text["text-body"]!, 2.35)).toBeCloseTo(15 * 2.35);
    expect(sizeAt(text["text-title-lg"]!, 2.35)).toBeCloseTo(30 * 1.54);
    expect(sizeAt(text["text-tab"]!, 2.35)).toBeCloseTo(11.5 * 1.3);
    // A field under 16 px makes WebKit zoom the page on focus.
    expect(sizeAt(text["text-base"]!, 0.82)).toBe(16);
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

  // In px, so a larger text size, the phone's or the browser's, grows no margin or gap.
  it("keeps the 4 px spacing step", () => {
    expect(declared(/--(spacing):\s*([^;]+);/g)).toEqual({ spacing: "4px" });
  });
});

// The palette's slots in light and dark, and in the stronger set drawn when more contrast is asked
// for. A tone marked derived is chosen here to pass AA where the identity gives only a fill; its
// measured ratio is pinned below.
const SLOTS = {
  light: {
    background: "#f3f5f5",
    surface: "#ffffff",
    foreground: "#12181c",
    "muted-foreground": "#4a555c",
    border: "#d5dbdd",
    input: "#6c777e",
    track: "#e8eced",
    sunk: "#edf0f1",
    "chart-day": "#8a9297",
    mark: "#1f4e8c",
    "on-mark": "#ffffff",
    ring: "#1f4e8c",
    destructive: "#b42318",
    primary: "#12181c",
    glass: "rgba(255, 255, 255, 0.82)",
  },
  dark: {
    background: "#10151a",
    surface: "#182027",
    foreground: "#eef2f3",
    "muted-foreground": "#a9b5bc",
    border: "#2e3a43",
    input: "#6f7d86",
    track: "#232d35",
    sunk: "#1f2931",
    "chart-day": "#667079",
    mark: "#8db6ee",
    "on-mark": "#10151a",
    ring: "#8db6ee",
    // Derived: the identity's dark danger, #c4321f, is a fill, 3.0:1 as text on the dark surface.
    destructive: "#f2998f",
    primary: "#eef2f3",
    glass: "rgba(24, 32, 39, 0.84)",
  },
  "more light": {
    background: "#f3f5f5",
    surface: "#ffffff",
    foreground: "#000000",
    "muted-foreground": "#343d43",
    border: "#8e9aa1",
    // Derived: the field outline takes the muted ink, the line being too light to edge a field.
    input: "#343d43",
    track: "#dde3e5",
    sunk: "#e4e9ea",
    "chart-day": "#5f686e",
    mark: "#143a6b",
    "on-mark": "#ffffff",
    ring: "#143a6b",
    destructive: "#9a1b12",
    primary: "#000000",
    glass: "rgba(255, 255, 255, 0.82)",
  },
  "more dark": {
    background: "#0a0e12",
    surface: "#182027",
    foreground: "#ffffff",
    "muted-foreground": "#cbd4d9",
    border: "#6f7d86",
    input: "#cbd4d9",
    track: "#2e3a43",
    sunk: "#27323b",
    "chart-day": "#98a3aa",
    mark: "#b5d0f5",
    "on-mark": "#000000",
    ring: "#b5d0f5",
    // Derived as in dark: the stronger set's danger here, #b42318, is a fill again.
    destructive: "#f2998f",
    primary: "#ffffff",
    glass: "rgba(24, 32, 39, 0.84)",
  },
} as const;

// [foreground, background, minimum]: 4.5 for text, 3 for focus rings, outlines, marks and charts.
const PAIRS = [
  ["foreground", "background", 4.5],
  ["foreground", "surface", 4.5],
  ["foreground", "track", 4.5],
  ["foreground", "sunk", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "surface", 4.5],
  ["muted-foreground", "track", 4.5],
  ["muted-foreground", "sunk", 4.5],
  ["primary", "background", 4.5],
  ["primary", "surface", 4.5],
  ["primary", "sunk", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["on-mark", "mark", 4.5],
  ["primary-ink", "primary-soft", 4.5],
  ["primary-ink", "surface", 4.5],
  ["reference-ink", "reference", 4.5],
  ["background", "foreground", 4.5], // the toast
  ["toast-action", "foreground", 4.5],
  ["destructive", "surface", 4.5],
  ["destructive", "background", 4.5],
  ["primary-ink", "tab-pill", 4.5], // the active tab's label on its pill
  ["foreground", "toast-icon", 4.5], // « Resume » on the pause banner
  ["input", "surface", 3],
  ["input", "background", 3],
  ["ring", "background", 3],
  ["ring", "surface", 3],
  ["mark", "background", 3],
  ["mark", "surface", 3],
  ["primary", "track", 3],
  // The daily weigh-ins sit on the card, each ringed in the card's colour where a band runs under.
  ["chart-dot", "surface", 3],
  ["chart-line", "surface", 3],
  ["chart-line", "primary-soft", 3],
  // The body map's primary tone, on the card and on the track behind a thumbnail.
  ["muscle-primary", "surface", 3],
  ["muscle-primary", "track", 3],
  ["primary-ink", "track", 3], // the error edge on a field's fill
  ["toast-icon", "foreground", 3], // the session bar's timer and the toast's error icon
] as const;

describe("palette", () => {
  it.each(EACH_SET)("%s holds its slots", (name, tokens) => {
    const slots = SLOTS[name];
    expect(Object.fromEntries(Object.keys(slots).map((k) => [k, tokens[k]]))).toEqual(slots);
  });

  it.each(EACH_SET)("%s meets AA on every pair", (_, tokens) => {
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrastRatio(tokens[fg]!, tokens[bg]!);
      expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    }
  });

  // Ink is the tint: what was orange is ink, the soft green of done sets and ranges is the sunk
  // tint, and the blue stays with the mark and the focus ring.
  it.each(EACH_SET)("%s tints in ink and keeps no green", (_, tokens) => {
    for (const ink of ["primary", "primary-ink", "reference-ink", "chart-line", "muscle-primary"])
      expect(tokens[ink], ink).toBe(tokens.foreground);
    for (const soft of ["primary-soft", "reference"]) expect(tokens[soft], soft).toBe(tokens.sunk);
    expect(tokens["chart-dot"]).toBe(tokens["chart-day"]);
    expect(tokens.ring).toBe(tokens.mark);
  });

  it("measures the derived tones", () => {
    const ratio = (set: keyof typeof SETS, fg: string, bg: string) =>
      Number(contrastRatio(SETS[set][fg]!, SETS[set][bg]!).toFixed(2));
    // Dark danger as text: the fill #c4321f gave 3.0:1 here.
    expect(ratio("dark", "destructive", "surface")).toBe(7.63);
    expect(ratio("more dark", "destructive", "surface")).toBe(7.63);
    expect(ratio("more dark", "destructive", "background")).toBe(8.97);
    // The field outline in higher contrast, on a card.
    expect(ratio("more light", "input", "surface")).toBe(11.08);
    expect(ratio("more dark", "input", "surface")).toBe(10.95);
  });

  // The setting the page is given and the browser's own preference draw the same values.
  it.each([
    [MORE_LIGHT, ":root:not(.dark)"],
    [MORE_DARK, ":root.dark"],
  ])("%s repeats the prefers-contrast block exactly", (selector, nested) => {
    const media = css.slice(css.indexOf(MEDIA_MORE));
    expect(readTokens(media, nested, "  ")).toEqual(readTokens(css, selector));
  });
});
