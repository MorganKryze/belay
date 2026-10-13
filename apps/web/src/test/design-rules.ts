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
