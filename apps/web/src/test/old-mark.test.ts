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
// No shipped file is waiting to move to the new mark any more.
const PENDING: readonly string[] = [];

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
