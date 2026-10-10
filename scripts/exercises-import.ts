// Imports the exercise library from exercises-dataset at the commit pinned in
// packages/shared/src/exercises/import.ts and writes its four files (network, at dev time only).
// With --check, validates the committed files offline: CI runs it, nothing is fetched.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import {
  buildLibrary,
  checkLibrary,
  DATASET_URL,
  type LibraryFiles,
} from "../packages/shared/src/exercises/import";

const NAMES = ["index", "fr", "en", "ids"] as const;
const path = (name: string) =>
  fileURLToPath(new URL(`../packages/shared/src/exercises/data/${name}.json`, import.meta.url));

function readCommitted(): LibraryFiles | null {
  try {
    return Object.fromEntries(
      NAMES.map((name) => [name, JSON.parse(readFileSync(path(name), "utf8"))]),
    ) as LibraryFiles;
  } catch {
    return null; // the first import
  }
}

function fail(problems: string[]): never {
  console.error(problems.map((p) => `- ${p}`).join("\n"));
  process.exit(1);
}

if (process.argv.includes("--check")) {
  const files = readCommitted();
  if (!files) fail(["the library files are missing: run `pnpm exercises:import`"]);
  const problems = checkLibrary(files);
  if (problems.length > 0) fail(problems);
  console.log(`The exercise library is valid: ${files.index.length} exercises.`);
} else {
  const response = await fetch(DATASET_URL);
  if (!response.ok) fail([`${DATASET_URL} answered ${response.status}`]);
  const files = buildLibrary((await response.json()) as unknown[], readCommitted());
  const problems = checkLibrary(files);
  if (problems.length > 0) fail(problems);
  for (const name of NAMES) {
    const options = await prettier.resolveConfig(path(name));
    const text = await prettier.format(JSON.stringify(files[name]), {
      ...options,
      filepath: path(name),
    });
    writeFileSync(path(name), text);
  }
  console.log(`Wrote ${files.index.length} exercises.`);
}
