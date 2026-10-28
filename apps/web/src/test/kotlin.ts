// The Android app's Kotlin sources, read by the tests that hold the page and the native side to
// the same names and bounds.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const main = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../mobile/android/app/src/main/java/cloud/libresoftware/belay",
);

// A file of the app's own package, as "Prefs.kt".
export const kotlin = (file: string): string => readFileSync(join(main, file), "utf8");

// The string literals of `val <name> = setOf(...)`.
export function stringSet(source: string, name: string): string[] {
  const set = new RegExp(`\\bval ${name}\\b[^=]*=\\s*setOf\\(([^)]*)\\)`).exec(source);
  if (!set) throw new Error(`val ${name} = setOf(...) not found`);
  return [...set[1]!.matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
}

// The value of `const val <name> = <n>` or `<n>L`, its underscores dropped.
export function longConst(source: string, name: string): number {
  const value = new RegExp(`\\bconst val ${name}\\b[^=]*=\\s*(-?[\\d_]+)L?\\b`).exec(source);
  if (!value) throw new Error(`const val ${name} not found`);
  return Number(value[1]!.replaceAll("_", ""));
}
