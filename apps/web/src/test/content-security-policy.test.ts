import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../../content-security-policy";

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

// Builds a one-line page with the plugin alone and returns the policy of its first head element.
async function builtPolicy(loopback: boolean) {
  const root = mkdtempSync(join(tmpdir(), "belay-csp-"));
  dirs.push(root);
  writeFileSync(
    join(root, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>',
  );
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: [contentSecurityPolicy(loopback)],
  });
  const html = readFileSync(join(root, "dist/index.html"), "utf8");
  const first = new DOMParser().parseFromString(html, "text/html").head.firstElementChild;
  expect(first?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
  return Object.fromEntries(
    first!
      .getAttribute("content")!
      .split("; ")
      .map((d) => {
        const [name, ...values] = d.split(" ");
        return [name, values];
      }),
  ) as Record<string, string[]>;
}

describe("content security policy meta", () => {
  it("a production build reaches instances over https only", async () => {
    const policy = await builtPolicy(false);
    expect(policy["connect-src"]).toEqual(["'self'", "https:"]);
    expect(policy["script-src"]).toEqual(["'self'"]);
  });

  it("a development build also reaches this machine over http", async () => {
    const policy = await builtPolicy(true);
    expect(policy["connect-src"]).toEqual([
      "'self'",
      "https:",
      "http://localhost:*",
      "http://127.0.0.1:*",
    ]);
  });
});
