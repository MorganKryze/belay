import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { kotlin } from "@/test/kotlin";

// The Android project's shape, read from its sources: the plugin the page calls, and what the
// manifest and the network rules let out of the phone.
const app = join(dirname(fileURLToPath(import.meta.url)), "../../../mobile/android/app/src");
const read = (path: string) => readFileSync(join(app, path), "utf8");
const manifest = () => read("main/AndroidManifest.xml");
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

  it("system back goes to the previous page, and with none sends the app to the background", () => {
    const source = kotlin("MainActivity.kt");
    const start = source.indexOf("super.onCreate");
    const added = source.indexOf(
      "onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true)",
    );
    expect(start).toBeGreaterThan(-1);
    expect(added).toBeGreaterThan(start);
    const handler = /fun handleOnBackPressed\(\) \{([\s\S]*?)\n\s*\}/.exec(source)?.[1] ?? "";
    expect(handler.replace(/\s+/g, " ").trim()).toBe(
      "val webView = bridge.webView if (webView.canGoBack()) webView.goBack() else moveTaskToBack(true)",
    );
  });

  it("the plugin answers to BelayNative with the page's six methods", () => {
    const source = kotlin("BelayNativePlugin.kt");
    expect(source).toContain('@CapacitorPlugin(name = "BelayNative")');
    const methods = [...source.matchAll(/@PluginMethod\s+fun (\w+)\(/g)].map((m) => m[1]!).sort();
    expect(pageMethods()).toHaveLength(6);
    expect(methods).toEqual(pageMethods());
  });

  it("nothing private is backed up", () => {
    expect(manifest()).toContain('android:allowBackup="false"');
    expect(manifest()).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
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

  // The phone's records live under the web view's origin: a default that moved in a later
  // Capacitor would open the app on an empty database, its unsent changes left behind.
  it("the web view's origin is pinned to the one the server allows", () => {
    const config = JSON.parse(readFileSync(join(app, "../../../capacitor.config.json"), "utf8"));
    expect(config.server).toEqual({ androidScheme: "https", hostname: "localhost" });
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

  it("installs as Belay, from Android 9, built for Android 16, in portrait", () => {
    expect(read("../build.gradle")).toMatch(/^\s*applicationId "cloud\.libresoftware\.belay"$/m);
    expect(read("main/res/values/strings.xml")).toContain('<string name="app_name">Belay</string>');
    const sdk = (name: string) =>
      new RegExp(`^\\s*${name} = (\\d+)$`, "m").exec(read("../../variables.gradle"))?.[1];
    expect([sdk("minSdkVersion"), sdk("compileSdkVersion"), sdk("targetSdkVersion")]).toEqual([
      "28",
      "36",
      "36",
    ]);
    const main = /<activity\b[^>]*android:name="\.MainActivity"[^>]*>/.exec(manifest())?.[0] ?? "";
    expect(main).toContain('android:screenOrientation="portrait"');
  });

  it("git never tracks the signing keys, the local paths, the build or the copied web app", () => {
    const ignored = read("../../.gitignore").split("\n");
    for (const entry of [
      "*.jks",
      "*.keystore",
      "local.properties",
      "build/",
      "app/src/main/assets/public",
    ])
      expect(ignored).toContain(entry);
  });

  // Older web views lack what the web app needs; the README names the version to have.
  it("asks for Android System WebView 111 or later, as the README says", () => {
    const config = JSON.parse(readFileSync(join(app, "../../../capacitor.config.json"), "utf8"));
    expect(config.android.minWebViewVersion).toBe(111);
    const readme = readFileSync(join(app, "../../../README.md"), "utf8").replace(/\s+/g, " ");
    expect(readme).toContain("**Android System WebView** 111 or later");
  });

  // Exact alarms come at install: USE_EXACT_ALARM from Android 13, SCHEDULE_EXACT_ALARM before it.
  // The latter stops at Android 12L and replaces the notifications plugin's line for every version.
  it("declares the exact alarm permissions each Android version grants at install", () => {
    const permission = (name: string) =>
      [...manifest().matchAll(/<uses-permission\b[^>]*>/g)]
        .map((m) => m[0].replace(/\s+/g, " "))
        .filter((tag) => tag.includes(`android:name="android.permission.${name}"`));
    expect(permission("USE_EXACT_ALARM")).toEqual([
      '<uses-permission android:name="android.permission.USE_EXACT_ALARM" />',
    ]);
    expect(permission("SCHEDULE_EXACT_ALARM")).toEqual([
      '<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" android:maxSdkVersion="32" tools:node="replace" />',
    ]);
  });
});
