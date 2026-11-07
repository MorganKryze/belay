import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTokens, resolveTokens } from "@/lib/contrast";

// Read from disk: the stylesheet is the single source of the tokens.
// A path, not new URL(): under jsdom, URL is not the class node:fs accepts.
export const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../index.css"),
  "utf8",
);

// The two selectors that turn the higher-contrast values on, a setting the page is given and the
// browser's own preference, each with its light and dark block.
export const MORE_LIGHT = 'html[data-contrast="more"]:not(.dark)';
export const MORE_DARK = 'html.dark[data-contrast="more"]';
export const MEDIA_MORE = "@media (prefers-contrast: more) {";

const root = readTokens(css, ":root");
const dark = readTokens(css, ".dark");

// Each theme as the root ends up with it: the light tokens, then what the dark and higher-contrast
// blocks put over them, every alias resolved.
export const SETS = {
  light: resolveTokens(root),
  dark: resolveTokens({ ...root, ...dark }),
  "more light": resolveTokens({ ...root, ...readTokens(css, MORE_LIGHT) }),
  "more dark": resolveTokens({ ...root, ...dark, ...readTokens(css, MORE_DARK) }),
} as const;

export const EACH_SET = Object.entries(SETS) as [keyof typeof SETS, Record<string, string>][];
