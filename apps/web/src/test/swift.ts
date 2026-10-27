// The iPhone app's Swift sources, read by the tests that hold the page's JSON to the shapes the
// native side decodes.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "../../../ios/ios/App");

// A file under the app's sources, as "App/Health.swift".
export const swift = (path: string): string => readFileSync(join(app, path), "utf8");

// The body of `struct <name>` or `enum <name>`, between its brace and the one that closes it.
export function body(source: string, kind: "struct" | "enum", name: string): string {
  const start = new RegExp(`\\b${kind} ${name}\\b[^{]*\\{`).exec(source);
  if (!start) throw new Error(`${kind} ${name} not found`);
  const from = start.index + start[0].length;
  let depth = 1;
  for (let i = from; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(from, i);
  }
  throw new Error(`${kind} ${name} is not closed`);
}

// What a body declares at its own level: the braces of a nested function or type are left out.
function outer(block: string): string {
  const nested = /\{[^{}]*\}/g;
  let level = block;
  while (nested.test(level)) level = level.replace(nested, "");
  return level;
}

// The stored properties declared right in a body.
export function fields(block: string, keyword: "var" | "let"): string[] {
  return [...outer(block).matchAll(new RegExp(`^\\s*${keyword} (\\w+):`, "gm"))]
    .map((m) => m[1]!)
    .sort();
}

// The cases an enum declares, `case a, b` as `case a(Payload)`, by name: a keyword used as a name
// loses its backticks. A switch's `case .a:` is not a declaration and does not match.
export function cases(block: string): string[] {
  return [...outer(block).matchAll(/\bcase ([`\w][`\w, ]*)/g)]
    .flatMap((m) => m[1]!.split(","))
    .map((name) => name.trim().replaceAll("`", ""))
    .filter(Boolean)
    .sort();
}
