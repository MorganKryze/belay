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
    const found = files.flatMap((file) =>
      rawColours(readFileSync(file, "utf8")).map((colour) => `${file}: ${colour}`),
    );
    expect(found).toEqual([]);
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

  it("keyframes move only transform and opacity", () => {
    expect(CSS).toMatch(/@keyframes/);
    expect(keyframeViolations(CSS)).toEqual([]);
    expect(keyframeViolations("@keyframes grow { from { height: 0; opacity: 0 } }")).toEqual([
      "grow: height",
    ]);
  });

  it("reduced motion swaps every enter for a 120 ms fade, every leave for a 120 ms fade, and stills the tick pop and the loading arc", () => {
    const theme = declarations(block(CSS, "@theme static {"));
    const media = block(CSS, "@media (prefers-reduced-motion: reduce)");
    const reduced = declarations(media);
    const names = [...theme.keys()].filter((k) => k.startsWith("--animate-"));
    expect(names.length).toBeGreaterThanOrEqual(11);
    for (const name of names) {
      const value = reduced.get(name);
      if (name === "--animate-pop-in" || name === "--animate-spin-arc") {
        expect(value, name).toBe("none");
      } else if (name.endsWith("-in")) {
        expect(value, name).toBe("fade-in var(--dur-reduced) var(--ease-out) both");
      } else {
        expect(value, name).toBe("fade-out var(--dur-reduced) var(--ease-exit) both");
      }
    }
    expect(reduced.get("--press-scale")).toBe("1");
    expect(reduced.get("--slide-duration")).toBe("0s");
    expect(reduced.get("--tint-duration")).toBe("0s");
  });

  it("press scales by the press and release tokens on the nav curve; rows only tint", () => {
    const press = block(CSS, "@utility press {");
    expect(press).toMatch(/transition:\s*transform var\(--dur-release\) var\(--ease-nav\)/);
    expect(press).toMatch(/&:active\s*\{[^}]*transform:\s*scale\(var\(--press-scale\)\)/);
    expect(press).toMatch(/transition-duration:\s*var\(--dur-press\)/);
    const tint = block(CSS, "@utility press-tint {");
    expect(tint).toMatch(/transition:\s*background-color var\(--tint-duration\) var\(--ease-out\)/);
    expect(tint).toMatch(/background-color:\s*var\(--press-tint\)/);
    expect(tint).not.toMatch(/transform/);
  });

  it("the frosted surface falls back to an opaque background without backdrop-filter", () => {
    const glass = block(CSS, "@utility glass {");
    expect(glass).toMatch(/background-color:\s*var\(--glass\)/);
    expect(glass).toMatch(/backdrop-filter:\s*saturate\(180%\) blur\(10px\)/);
    expect(block(glass, "@supports not (backdrop-filter: blur(1px))")).toMatch(
      /background-color:\s*var\(--glass-fallback\)/,
    );
  });

  it("the old 0.01 ms blanket rule is gone", () => {
    expect(CSS).not.toMatch(/0\.01ms/);
  });
});
