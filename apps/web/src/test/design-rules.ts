import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every application source file: tests and test helpers may name colours to check them.
export function sourceFiles(): string[] {
  return readdirSync(SRC, { recursive: true, encoding: "utf8" })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .filter((f) => f.split(sep)[0] !== "test")
    .map((f) => join(SRC, f));
}

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const RAW_COLOUR = new RegExp(
  [
    String.raw`#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b`,
    String.raw`\b(?:rgba?|hsla?|oklch)\([^)]*\)`,
    String.raw`\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|accent|caret|placeholder|shadow)-(?:white|black|(?:${PALETTE})-\d{2,3})\b`,
  ].join("|"),
  "g",
);

// Colours written in the code instead of through a token.
export function rawColours(source: string): string[] {
  return source.match(RAW_COLOUR) ?? [];
}

// Arbitrary type and radius values with a raw length; a calc() on a radius token is allowed.
export function arbitraryScale(source: string): string[] {
  return [...source.matchAll(/\b(?:text|rounded(?:-[a-z]{1,2})?|leading|tracking)-\[([^\]]+)\]/g)]
    .filter((m) => /^-?[\d.]/.test(m[1]!))
    .map((m) => m[0]);
}

export function expectTokensOnly(relPath: string): void {
  const source = readFileSync(join(SRC, relPath), "utf8");
  expect(rawColours(source), `${relPath} colours`).toEqual([]);
  expect(arbitraryScale(source), `${relPath} sizes`).toEqual([]);
}

const LAYOUT =
  /\b(?:width|height|top|left|right|bottom|inset|margin|padding|max-height|max-width|min-height|min-width|gap|grid|flex)\b/;
const MOTION = new RegExp(
  [
    String.raw`\btransition-all\b`,
    String.raw`\btransition:\s*all\b`,
    String.raw`\btransition-\[[^\]]*\]`,
    String.raw`\bduration-(?:\d+|\[[^\]]*\])`,
    String.raw`\bease-(?:in-out|in|linear|\[[^\]]*\])(?![\w-])`,
    String.raw`\bdelay-[\w[(-]+`,
    String.raw`\banimate-(?:in|out)\b`,
    String.raw`\bzoom-(?:in|out)-[\w-]+`,
    String.raw`\bslide-(?:in|out)-from-[\w-]+`,
    String.raw`\b(?:transition|animation)(?:Duration|Delay)?:\s*["'\`][^"'\`]*\b\d+(?:\.\d+)?m?s\b`,
  ].join("|"),
  "g",
);

// Motion that skips the charter's tokens: raw durations and curves, transitions on every property
// or on a layout property, the generic enter/exit kit, and named transitions left on the default
// 150 ms (a named transition needs a duration token in the same class list).
export function motionViolations(source: string): string[] {
  const found = (source.match(MOTION) ?? []).filter(
    (m) => !m.startsWith("transition-[") || LAYOUT.test(m),
  );
  for (const list of source.match(/"[^"\n]*"|`[^`]*`/g) ?? []) {
    const named = list.match(
      /(?<![\w-])transition(?:-(?:transform|colors|opacity|shadow))?(?![\w-[])/g,
    );
    if (named && !/\bduration-\(--/.test(list)) found.push(...named);
  }
  return found;
}

// Properties a keyframe may move: only the compositor-friendly ones.
const KEYFRAME_OK = new Set(["transform", "translate", "scale", "rotate", "opacity"]);

export function keyframeViolations(css: string): string[] {
  const found: string[] = [];
  for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const d of m[2]!.matchAll(/([\w-]+)\s*:/g)) {
      if (!KEYFRAME_OK.has(d[1]!)) found.push(`${m[1]}: ${d[1]}`);
    }
  }
  return found;
}
