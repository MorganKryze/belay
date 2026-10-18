import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import {
  arbitraryScale,
  keyframeViolations,
  motionViolations,
  rawColours,
  sourceFiles,
} from "@/test/design-rules";
import { LAUNCH_BACKGROUND } from "@/lib/theme";

const CSS = readFileSync(join(__dirname, "..", "index.css"), "utf8");

function block(css: string, start: string): string {
  const at = css.indexOf(start);
  if (at < 0) return "";
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  return "";
}

function declarations(css: string): Map<string, string> {
  return new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

describe("design rules", () => {
  it("no component code carries a raw colour", () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(20);
    // The browser bar's colours live outside CSS; the next test holds them to the tokens.
    const launch = Object.values(LAUNCH_BACKGROUND).map(
      (colour) => `${join(__dirname, "theme.ts")}: ${colour}`,
    );
    const found = files.flatMap((file) =>
      rawColours(readFileSync(file, "utf8")).map((colour) => `${file}: ${colour}`),
    );
    expect(found.filter((entry) => !launch.includes(entry))).toEqual([]);
  });

  it("the launch colours are the page's background tokens", () => {
    const token = (selector: string) =>
      declarations(block(CSS, selector)).get("--background")?.toUpperCase();
    expect(LAUNCH_BACKGROUND).toEqual({ light: token(":root {"), dark: token(".dark {") });
  });

  it("finds hex, functional and palette colours", () => {
    expect(
      rawColours(
        'a = "#facc15"; b = "#fff"; c = "rgba(0, 0, 0, 0.5)"; d = "hsl(10 20% 30%)"; e = "oklch(0.7 0.1 40)"; f = "bg-white text-red-600"',
      ),
    ).toEqual([
      "#facc15",
      "#fff",
      "rgba(0, 0, 0, 0.5)",
      "hsl(10 20% 30%)",
      "oklch(0.7 0.1 40)",
      "bg-white",
      "text-red-600",
    ]);
  });

  it("leaves tokens alone", () => {
    expect(
      rawColours('className="bg-primary text-muted-foreground" fill="var(--hold-red)"'),
    ).toEqual([]);
  });

  it("finds arbitrary sizes outside the scales", () => {
    expect(
      arbitraryScale(
        'className="text-[15px] rounded-[7px] leading-[1.4] tracking-[-0.02em] rounded-[calc(var(--radius-card)-4px)] text-[var(--x)]"',
      ),
    ).toEqual(["text-[15px]", "rounded-[7px]", "leading-[1.4]", "tracking-[-0.02em]"]);
  });

  it("no component uses a raw duration, curve or a transition on every property", () => {
    const found = sourceFiles().flatMap((file) =>
      motionViolations(readFileSync(file, "utf8")).map((v) => `${file}: ${v}`),
    );
    expect(found).toEqual([]);
  });

  it("finds raw motion and leaves tokens alone", () => {
    expect(
      motionViolations(
        'a="transition-all duration-150 ease-in-out delay-75 animate-in zoom-in-95 slide-in-from-top-2 transition-[height]"; b={{ transition: "opacity 200ms" }}; c="transition-transform"',
      ),
    ).toEqual([
      "transition-all",
      "duration-150",
      "ease-in-out",
      "delay-75",
      "animate-in",
      "zoom-in-95",
      "slide-in-from-top-2",
      "transition-[height]",
      'transition: "opacity 200ms',
      "transition-transform",
    ]);
    expect(
      motionViolations(
        'a="transition-transform duration-(--dur-fast) ease-out press animate-fade-in transition-[color,box-shadow]"',
      ),
    ).toEqual([]);
  });

  it("keyframes move only transform and opacity, the veil aside", () => {
    expect(CSS).toMatch(/@keyframes/);
    expect(keyframeViolations(CSS)).toEqual([]);
    expect(keyframeViolations("@keyframes grow { from { height: 0; opacity: 0 } }")).toEqual([
      "grow: height",
    ]);
  });

  it("only the veil animates a colour in its keyframes", () => {
    expect(CSS).toMatch(/@keyframes veil-in\s*\{\s*from\s*\{\s*background-color:\s*transparent;/);
    expect(CSS).toMatch(/@keyframes veil-out\s*\{\s*to\s*\{\s*background-color:\s*transparent;/);
    expect(
      keyframeViolations(
        "@keyframes veil-in { from { background-color: transparent; } } @keyframes veil-out { to { background-color: transparent; } }",
      ),
    ).toEqual([]);
    expect(
      keyframeViolations("@keyframes tint { from { background-color: transparent; } }"),
    ).toEqual(["tint: background-color"]);
    expect(keyframeViolations("@keyframes veil-in { from { color: red; height: 0; } }")).toEqual([
      "veil-in: color",
      "veil-in: height",
    ]);
  });

  it("reduced motion keeps every enter and leave a fade of 120 ms at most, except the listed slides, veils, the session bar and the tabs", () => {
    // Sheets still slide and their veil fades a little longer, the way iOS does it.
    const ALLOWED: Record<string, string> = {
      "--animate-sheet-in": "sheet-in var(--dur-slide-reduced) var(--ease-out) both",
      "--animate-sheet-out": "sheet-out var(--dur-slide-reduced) var(--ease-out) both",
      "--animate-overlay-in": "veil-in var(--dur-veil-reduced) var(--ease-out) both",
      "--animate-overlay-out": "veil-out var(--dur-veil-reduced) var(--ease-out) both",
      // A pushed page slides in over a still page and Back slides it out the same way; the session
      // cover rises and sinks like a sheet.
      "--animate-page-push-in": "page-push-in var(--dur-slide-reduced) var(--ease-out) both",
      "--animate-page-push-out": "none",
      "--animate-page-back-in": "none",
      "--animate-page-back-out": "page-back-out var(--dur-slide-reduced) var(--ease-out) both",
      "--animate-page-cover-in": "sheet-in var(--dur-slide-reduced) var(--ease-out) both",
      "--animate-page-uncover-out": "sheet-out var(--dur-slide-reduced) var(--ease-out) both",
      "--animate-page-under-in": "none",
      "--animate-page-under-out": "none",
      // The session bar fades in at the veil's pace as the session lowers onto the page.
      "--animate-session-bar-in": "fade-in var(--dur-veil-reduced) var(--ease-out) both",
      // The tabs come back at the same pace when the session cover rises or sinks.
      "--animate-dock-in": "fade-in var(--dur-veil-reduced) var(--ease-out) both",
    };
    const theme = declarations(block(CSS, "@theme static {"));
    const media = block(CSS, "@media (prefers-reduced-motion: reduce)");
    const reduced = declarations(media);
    const names = [...theme.keys()].filter((k) => k.startsWith("--animate-"));
    expect(names.length).toBeGreaterThanOrEqual(11);
    for (const name of Object.keys(ALLOWED)) expect(names, name).toContain(name);
    for (const name of ["--animate-breathe", "--animate-loader-in"])
      expect(names, name).toContain(name);
    for (const name of names) {
      const value = reduced.get(name);
      if (name in ALLOWED) {
        expect(value, name).toBe(ALLOWED[name]);
      } else if (name === "--animate-loader-in") {
        // The loader only brightens, so it keeps its fade.
        expect(value, name).toBeUndefined();
        expect(theme.get(name), name).toBe("loader-in var(--dur-release) var(--ease-out) both");
      } else if (
        name === "--animate-pop-in" ||
        name === "--animate-spin-arc" ||
        name === "--animate-breathe"
      ) {
        expect(value, name).toBe("none");
      } else if (name.endsWith("-in")) {
        expect(value, name).toBe("fade-in var(--dur-reduced) var(--ease-out) both");
      } else {
        expect(value, name).toBe("fade-out var(--dur-reduced) var(--ease-exit) both");
      }
    }
    expect(reduced.get("--dock-fade")).toBe("var(--dur-veil-reduced)");
    expect(theme.get("--animate-dock-in")).toBe(theme.get("--animate-fade-in"));
    expect(CSS).toMatch(
      /html:active-view-transition-type\(cover, uncover\)::view-transition-new\(dock\)\s*\{\s*animation: var\(--animate-dock-in\);/,
    );
    expect(reduced.get("--press-scale")).toBe("1");
    expect(reduced.get("--slide-duration")).toBe("0s");
    expect(reduced.get("--tint-duration")).toBe("0s");
    expect(reduced.get("--press-release")).toBe("0s");
    expect(reduced.get("--untint-duration")).toBe("0s");
    // The launch screen still fades out, in the reduced duration.
    expect(reduced.get("--dur-launch-out")).toBe("var(--dur-reduced)");
    // A card let go short of closing slides back as in normal motion.
    expect([...reduced.keys()].filter((k) => k.startsWith("--swipe-"))).toEqual([]);
  });

  it("the dark row tint is 7 % of the foreground, light 6 %", () => {
    expect(declarations(block(CSS, ":root {")).get("--press-tint")).toBe(
      "color-mix(in srgb, var(--foreground) 6%, transparent)",
    );
    expect(declarations(block(CSS, ".dark {")).get("--press-tint")).toBe(
      "color-mix(in srgb, var(--foreground) 7%, transparent)",
    );
  });

  it("every transition duration a component names goes to 0s with reduced motion, unless it only fades", () => {
    const reduced = declarations(block(CSS, "@media (prefers-reduced-motion: reduce)"));
    const found = sourceFiles().flatMap((file) =>
      (readFileSync(file, "utf8").match(/"[^"\n]*"|`[^`]*`/g) ?? []).flatMap((list) => {
        const fadesOnly = /(?<![\w-])transition-opacity(?![\w-])/.test(list);
        return [...list.matchAll(/\bduration-\((--[\w-]+)\)/g)]
          .filter((m) => !fadesOnly && reduced.get(m[1]!) !== "0s")
          .map((m) => `${file}: ${m[0]}`);
      }),
    );
    expect(found).toEqual([]);
  });

  it("press scales at once, under a mouse or a finger, and springs back on the nav curve; rows only tint", () => {
    const press = block(CSS, "@utility press {");
    expect(press).toMatch(/transition:\s*transform var\(--press-release\) var\(--ease-nav\)/);
    expect(press).toMatch(
      /&:active,\s*&\[data-pressed\]\s*\{[^}]*transform:\s*scale\(var\(--press-scale\)\)/,
    );
    expect(press).toMatch(/&:active,\s*&\[data-pressed\]\s*\{[^}]*transition-duration:\s*0s/);
    const tint = block(CSS, "@utility press-tint {");
    expect(tint).toMatch(/transition:\s*background-color var\(--press-release\) var\(--ease-out\)/);
    expect(tint).toMatch(
      /&:active,\s*&\[data-pressed\]\s*\{[^}]*background-color:\s*var\(--press-tint\);[^}]*transition-duration:\s*0s/,
    );
    expect(tint).not.toMatch(/transform/);
    // The row left for a deeper page clears its tint on the way back over its own duration.
    expect(tint).toMatch(
      /&\[data-untint\]\s*\{\s*transition:\s*background-color var\(--untint-duration\) var\(--ease-out\)/,
    );
    expect(CSS).toMatch(/--untint-duration:\s*var\(--dur-untint\);/);
  });

  it("the frosted surface falls back to an opaque background without backdrop-filter", () => {
    const glass = block(CSS, "@utility glass {");
    expect(glass).toMatch(/background-color:\s*var\(--glass\)/);
    expect(glass).toMatch(/backdrop-filter:\s*saturate\(180%\) blur\(10px\)/);
    expect(block(glass, "@supports not (backdrop-filter: blur(1px))")).toMatch(
      /background-color:\s*var\(--glass-fallback\)/,
    );
  });

  it("the loading mark's two hooks share one frame that holds the whole mark", () => {
    // Hook A runs from y 140 down to its arc at 386, hook B from its arc at 126 down to 372; both
    // span x 86 to 426. A tighter frame cuts the arcs flat.
    const root = declarations(block(CSS, ":root {"));
    for (const hook of ["--hook-a", "--hook-b"]) {
      expect(root.get(hook), hook).toContain("viewBox='86 126 340 260'");
    }
    expect(block(CSS, "@utility loader-mark {")).toMatch(/aspect-ratio:\s*340 \/ 260;/);
  });

  it("the old 0.01 ms blanket rule is gone", () => {
    expect(CSS).not.toMatch(/0\.01ms/);
  });

  it("every text field uses the field surface", () => {
    const sites = [
      "components/number-stepper.tsx",
      "components/duration-stepper.tsx",
      "components/annotation-sheet.tsx",
      "routes/supplements.tsx",
      "workouts/exercise-picker.tsx",
      "exercises/exercises-panel.tsx",
      "routes/workout-summary.tsx",
      "workouts/exercise-card.tsx",
    ];
    for (const site of sites) {
      const source = readFileSync(join(__dirname, "..", site), "utf8");
      const classLists = [...source.matchAll(/"[^"\n]*"/g)].map((m) => m[0]);
      expect(
        classLists.some((c) => /(?:^"|\s)field(?:\s|"$)/.test(c)),
        `${site} field`,
      ).toBe(true);
      // The set cells of the exercise card keep their own outline; only field surfaces are checked.
      const fields = classLists.filter((c) => /(?:^"|\s)(?:field|rounded-field)(?:\s|"$)/.test(c));
      expect(
        fields.filter((c) => c.includes("border-input")),
        site,
      ).toEqual([]);
    }
    const field = block(CSS, "@utility field");
    expect(field).toContain("var(--track)");
    expect(field).toContain("aria-invalid");
    expect(field).toContain("var(--primary-ink)");
  });
});
