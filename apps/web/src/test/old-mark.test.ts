import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { walk } from "@/test/files";
import { oldHooksIn } from "@/test/old-hooks";

const web = resolve(__dirname, "../..");

// What the build ships: the sources without their tests, the page, its drawings and scripts.
const shipped = () =>
  [
    ...walk(join(web, "src")).filter((p) => !/\.test\.tsx?$/.test(p) && !p.includes("/src/test/")),
    join(web, "index.html"),
    ...walk(join(web, "public")).filter((p) => p.endsWith(".svg")),
    ...walk(join(web, "icons")),
    ...walk(join(web, "scripts")),
  ].map((p) => relative(web, p));

describe("the old mark", () => {
  it("is drawn by no shipped web file", () => {
    const found = shipped().flatMap((file) =>
      oldHooksIn(file, readFileSync(join(web, file), "latin1")),
    );
    expect(found).toEqual([]);
  });
});
