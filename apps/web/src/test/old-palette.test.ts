import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const web = resolve(__dirname, "../..");

// Every colour of the warm palette the app wore until now: the orange family and the warm
// neutrals, light and dark.
const OLD: readonly string[] = [
  "#fafaf7",
  "#57534e",
  "#e7e5e4",
  "#78716c",
  "#edebe8",
  "#c2410c",
  "#fff4ea",
  "#9a3412",
  "#dcebdd",
  "#24503a",
  "#fdba74",
  "#8a837e",
  "#f4b08a",
  "#dedad6",
  "#991b1b",
  "#fce3ce",
  "#fb923c",
  "#151412",
  "#1d1b19",
  "#2e2b28",
  "#2a2724",
  "#2a1e16",
  "#1e2e23",
  "#a7d3b2",
  "#ea580c",
  "#8a4524",
  "#36322f",
  "#fca5a5",
  "#3d2818",
];

// Plates and holds name real objects, so their colours stay, even where one matches a warm
// neutral the app no longer wears.
const KEEP: readonly string[] = [
  "#facc15",
  "#22c55e",
  "#2563eb",
  "#dc2626",
  "#111827",
  "#a855f7",
  "#f8fafc",
  "#b91c1c",
  "#1d4ed8",
  "#eab308",
  "#15803d",
  "#f5f5f4",
  "#a8a29e",
  "#ffffff",
  "#1c1917",
];

// The icons, the launch screen and the installed app's manifest, recoloured with the new mark.
const PENDING: readonly string[] = [
  "index.html",
  "public/logo.svg",
  "icons/app-icon.svg",
  "vite.config.ts",
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

// What the build ships: the app's sources without their tests, the scripts and drawings served
// as they are, the page, the icon sources and the build's own config.
const shipped = [
  ...walk(join(web, "src")).filter(
    (path) => !/\.test\.[jt]sx?$/.test(path) && !path.startsWith(join(web, "src/test/")),
  ),
  ...readdirSync(join(web, "public"))
    .filter((name) => /\.(js|svg)$/.test(name))
    .map((name) => join(web, "public", name)),
  join(web, "index.html"),
  ...walk(join(web, "icons")),
  join(web, "vite.config.ts"),
]
  .map((path) => relative(web, path))
  .filter((path) => /\.(css|html|js|json|svg|ts|tsx)$/.test(path));

describe("old palette", () => {
  it("keeps the plates' and holds' colours out of the list", () => {
    expect(OLD.filter((hex) => KEEP.includes(hex))).toEqual([]);
  });

  it("reads every pending file, so the exceptions stay narrow", () => {
    expect(PENDING.filter((path) => !shipped.includes(path))).toEqual([]);
  });

  it("ships no colour of the warm palette", () => {
    const found = shipped
      .filter((path) => !PENDING.includes(path))
      .flatMap((path) =>
        [...readFileSync(join(web, path), "utf8").matchAll(/#[0-9a-f]{6}(?![0-9a-f])/gi)]
          .map((m) => m[0].toLowerCase())
          .filter((hex) => OLD.includes(hex))
          .map((hex) => `${path}: ${hex}`),
      );
    expect(found).toEqual([]);
  });
});
