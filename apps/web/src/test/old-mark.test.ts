import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const web = resolve(__dirname, "../..");

// The two hooks' outlines and the names that coloured them apart.
const OLD: readonly string[] = [
  "M86 160L86 266",
  "M426 352L426 246",
  "A120 120 0 0 0 326 266",
  "--hook-a",
  "--hook-b",
];
// Files that still draw the hooks until the launch, the top bar and the cracks move to the mark.
const PENDING: readonly string[] = [
  "index.html",
  "src/index.css",
  "src/components/top-bar.tsx",
  "src/routes/fallbacks.tsx",
  "scripts/gen-cracks.mjs",
  "src/assets/cracks-light.svg",
  "src/assets/cracks-dark.svg",
];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });

const shipped = () =>
  [
    ...walk(join(web, "src")).filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes("/src/test/")),
    join(web, "index.html"),
    ...walk(join(web, "public")).filter((p) => p.endsWith(".svg")),
    ...walk(join(web, "icons")),
    ...walk(join(web, "scripts")),
  ]
    .map((p) => relative(web, p))
    .filter((p) => !PENDING.includes(p));

describe("the old mark", () => {
  it("is drawn by no shipped web file", () => {
    const found = shipped().flatMap((file) => {
      const text = readFileSync(join(web, file), "latin1");
      return OLD.filter((needle) => text.includes(needle)).map((needle) => `${file}: ${needle}`);
    });
    expect(found).toEqual([]);
  });
});
