import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Exercise loops are licensed to the operator, so the repository and the image never carry one.
const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("exercise loops stay out of the repository and the image", () => {
  it("the image's build context ignores every mp4", () => {
    const lines = readFileSync(`${root}.dockerignore`, "utf8").split("\n");
    expect(lines).toContain("**/*.mp4");
  });

  it("the only tracked mp4 is the synthetic e2e fixture", () => {
    const tracked = execFileSync("git", ["ls-files", "*.mp4"], { cwd: root, encoding: "utf8" });
    expect(tracked.trim().split("\n")).toEqual(["apps/web/e2e/fixtures/loop.mp4"]);
  });
});
