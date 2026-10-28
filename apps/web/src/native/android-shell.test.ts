import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kotlin } from "@/test/kotlin";

// The Android project's shape, read from its sources: the plugin the page calls, and what the
// manifest and the network rules let out of the phone.
const app = join(dirname(fileURLToPath(import.meta.url)), "../../../mobile/android/app/src");
const read = (path: string) => readFileSync(join(app, path), "utf8");
const pluginTs = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "plugin.ts"), "utf8");

// The method names of the page's `interface BelayNativePlugin`.
const pageMethods = () => {
  const block = /interface BelayNativePlugin \{([\s\S]*?)\n\}/.exec(pluginTs)![1]!;
  return [...block.matchAll(/^\s*(\w+)\(/gm)].map((m) => m[1]!).sort();
};

describe("the Android shell", () => {
  it("the Android app registers BelayNative before the bridge starts", () => {
    const source = kotlin("MainActivity.kt");
    const register = source.indexOf("registerPlugin(BelayNativePlugin::class.java)");
    const start = source.indexOf("super.onCreate");
    expect(register).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(register);
  });

  it("the plugin answers to BelayNative with the page's six methods", () => {
    const source = kotlin("BelayNativePlugin.kt");
    expect(source).toContain('@CapacitorPlugin(name = "BelayNative")');
    const methods = [...source.matchAll(/@PluginMethod\s+fun (\w+)\(/g)].map((m) => m[1]!).sort();
    expect(pageMethods()).toHaveLength(6);
    expect(methods).toEqual(pageMethods());
  });

  it("nothing private is backed up", () => {
    const manifest = read("main/AndroidManifest.xml");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
    const rules = read("main/res/xml/data_extraction_rules.xml");
    for (const section of ["cloud-backup", "device-transfer"]) {
      const block = new RegExp(`<${section}>([\\s\\S]*?)</${section}>`).exec(rules)?.[1] ?? "";
      const excluded = [...block.matchAll(/<exclude domain="(\w+)"/g)].map((m) => m[1]).sort();
      expect([section, excluded]).toEqual([
        section,
        ["database", "external", "file", "root", "sharedpref"],
      ]);
    }
  });

  it("release allows no plain http", () => {
    const release = read("main/res/xml/network_security_config.xml");
    expect(release).toContain('cleartextTrafficPermitted="false"');
    expect(release).not.toContain('cleartextTrafficPermitted="true"');
    const debug = read("debug/res/xml/network_security_config.xml");
    const domains = [...debug.matchAll(/<domain[^>]*>([^<]+)<\/domain>/g)].map((m) => m[1]).sort();
    expect(domains).toEqual(["127.0.0.1", "localhost"]);
    expect(debug).toMatch(/<base-config cleartextTrafficPermitted="false"/);
  });
});
