import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");
const sizes = [...css.matchAll(/--text-([a-z][a-z-]*?):/g)]
  .map((m) => m[1] ?? "")
  .filter((name) => !name.includes("--"));

describe("cn", () => {
  it("finds the project's size tokens", () => {
    expect(sizes).toContain("section");
    expect(sizes.length).toBeGreaterThan(5);
  });

  it.each(sizes)("keeps text-%s next to a text colour", (size) => {
    expect(cn(`text-${size}`, "text-muted-foreground").split(" ")).toEqual([
      `text-${size}`,
      "text-muted-foreground",
    ]);
    expect(cn("text-foreground", `text-${size}`).split(" ")).toEqual([
      "text-foreground",
      `text-${size}`,
    ]);
  });

  it("still merges two sizes and two colours", () => {
    expect(cn("text-section text-body")).toBe("text-body");
    expect(cn("text-foreground text-muted-foreground")).toBe("text-muted-foreground");
  });
});
