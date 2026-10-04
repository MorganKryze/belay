// Writes docs/science.md from the science catalogue; with --check, fails if it is out of date.
// Formatted with the repository's Prettier settings, so `pnpm lint` agrees with the file.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { renderScienceDoc } from "../packages/shared/src/science/render";

const target = fileURLToPath(new URL("../docs/science.md", import.meta.url));
const options = await prettier.resolveConfig(target);
const expected = await prettier.format(renderScienceDoc(), { ...options, filepath: target });

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // Missing file: reported as out of date below.
  }
  if (current !== expected) {
    console.error("docs/science.md is out of date. Run `pnpm science:doc` and commit the result.");
    process.exit(1);
  }
  console.log("docs/science.md is up to date.");
} else {
  writeFileSync(target, expected);
  console.log("Wrote docs/science.md");
}
