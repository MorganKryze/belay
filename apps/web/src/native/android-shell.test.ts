import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAUNCH_BACKGROUND } from "@/lib/theme";
import { kotlin, longConst, stringSet } from "@/test/kotlin";

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

  // Back asks the page first, which closes what is on top; the app's own step back is the
  // fallback when the page is silent or late, and stepping aside stays the only way out.
  it("system back asks the page, and only Accueil's answer or silence leaves", () => {
    const source = kotlin("MainActivity.kt");
    const start = source.indexOf("super.onCreate");
    const added = source.indexOf(
      "onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true)",
    );
    expect(start).toBeGreaterThan(-1);
    expect(added).toBeGreaterThan(start);
    const flat = source.replace(/\s+/g, " ");
    expect(flat).toContain(
      "val back = SystemBack(bridge.webView, Handler(Looper.getMainLooper())) { moveTaskToBack(true) }",
    );
    expect(flat).toContain("override fun handleOnBackPressed() = back.press()");
    expect(flat.match(/moveTaskToBack\(/g)).toHaveLength(1);
    expect(flat).not.toMatch(/\bfinish(AndRemoveTask)?\(\)/);

    const back = kotlin("SystemBack.kt");
    expect(longConst(back, "ANSWER_MS")).toBe(500);
    expect(back).toContain('"window.belayBack?.() ?? null"');
    // Every answer the page gives after taking its step; "home" alone lets the app step aside.
    expect(stringSet(back, "DONE")).toEqual(["surface", "cover", "page", "tab-root"]);
    expect(back.replace(/\s+/g, " ")).toContain(
      "if (webView.canGoBack()) webView.goBack() else leave()",
    );
    expect(back).not.toMatch(/\bfinish(AndRemoveTask)?\(\)/);
  });

  // The Android web view always reports itself online: the activity tells it the truth, so the
  // page can say « no connection » apart from an address that does not answer.
  it("the web view knows when the phone is offline", () => {
    const source = kotlin("MainActivity.kt").replace(/\s+/g, " ");
    // The callback says nothing when the app starts with no network: the first state is read.
    expect(source).toContain("online(connectivity.activeNetwork != null)");
    expect(source).toContain("registerDefaultNetworkCallback(network)");
    expect(source).toContain("override fun onAvailable(n: Network) = online(true)");
    expect(source).toContain("override fun onLost(n: Network) = online(false)");
    expect(source).toContain("bridge?.webView?.setNetworkAvailable(available)");
    expect(source).toContain("unregisterNetworkCallback(network)");
    expect(read("main/AndroidManifest.xml")).toContain(
      '<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
    );
  });

  // A permission the manifest leaves out is one Health Connect never shows: nothing fails, the
  // page just goes on asking.
  it("the manifest declares every health permission the app asks for", () => {
    const named = [
      ...kotlin("HealthRules.kt").matchAll(/const val \w+ = "(android\.permission\.health\.\w+)"/g),
    ].map((m) => m[1]!);
    expect(named).toContain("android.permission.health.READ_HEALTH_DATA_HISTORY");
    expect(named).toHaveLength(5);
    for (const permission of named) {
      expect(manifest()).toContain(`<uses-permission android:name="${permission}" />`);
    }
  });

  // Health Connect refuses a read the same way whether the permission is missing or not: the
  // bridge leaves that call to the rule the JVM tests hold.
  it("a refused weigh-in read goes through the rule on what is granted", () => {
    const source = kotlin("HealthBridge.kt").replace(/\s+/g, " ");
    expect(source).toContain(
      "HealthRules.readOrRefused( granted = { client.permissionController.getGrantedPermissions() }, read = { readAllowedWeighings(anchor, since) },",
    );
    expect(source).not.toContain("catch (_: SecurityException)");
  });

  // The notifications plugin makes a channel of its own as it loads: Belay's channels are made,
  // and that one removed, once the bridge has loaded every plugin.
  it("the channels are made once the bridge has loaded its plugins", () => {
    const source = kotlin("MainActivity.kt");
    const start = source.indexOf("super.onCreate");
    expect(start).toBeGreaterThan(-1);
    expect(source.indexOf("Channels.create(this)")).toBeGreaterThan(start);
    expect(kotlin("BelayNativePlugin.kt")).not.toContain("Channels.create");
  });

  // The rest alert names this drawable for its small icon, as the session notification uses it.
  it("Belay's small notification icon is in every density", () => {
    for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"]) {
      expect(existsSync(join(app, `main/res/drawable-${density}/ic_stat_belay.png`))).toBe(true);
    }
  });

  it("the plugin answers to BelayNative with the page's six methods", () => {
    const source = kotlin("BelayNativePlugin.kt");
    expect(source).toContain('@CapacitorPlugin(name = "BelayNative")');
    const methods = [...source.matchAll(/@PluginMethod\s+fun (\w+)\(/g)].map((m) => m[1]!).sort();
    expect(pageMethods()).toHaveLength(6);
    expect(methods).toEqual(pageMethods());
  });

  // Android would zoom the page's text by the font scale on its own, and the page scales it again
  // from the ratio it reads: the web view's zoom stays at 100 % and the ratio is handed over as
  // the plugin loads, before the bridge loads the page. A change of the font scale restarts the
  // activity, which reads it again.
  it("hands the page the font scale once and keeps the web view's own zoom at 100 %", () => {
    const source = kotlin("BelayNativePlugin.kt").replace(/\s+/g, " ");
    const load = /override fun load\(\) \{(.*?)\} override fun/.exec(source)![1]!;
    expect(load).toContain("val scale = context.resources.configuration.fontScale");
    expect(load).toContain("bridge.webView.settings.textZoom = 100");
    expect(load).toContain('bridge.webView.addJavascriptInterface(TextScale(scale), "BelayText")');
    expect(source).toContain(
      "class TextScale(private val scale: Float) { @JavascriptInterface fun scale(): Float = scale }",
    );
    expect(source.match(/@JavascriptInterface/g)).toHaveLength(1);
    const init = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../public/theme-init.js"),
      "utf8",
    );
    expect(init).toContain("globalThis.BelayText?.scale()");
    expect(manifest()).not.toMatch(/android:configChanges="[^"]*fontScale/);
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

  it("installs as Belay, from Android 9, built for Android 16", () => {
    expect(read("../build.gradle")).toMatch(/^\s*applicationId "cloud\.libresoftware\.belay"$/m);
    expect(read("main/res/values/strings.xml")).toContain('<string name="app_name">Belay</string>');
    const sdk = (name: string) =>
      new RegExp(`^\\s*${name} = (\\d+)$`, "m").exec(read("../../variables.gradle"))?.[1];
    expect([sdk("minSdkVersion"), sdk("compileSdkVersion"), sdk("targetSdkVersion")]).toEqual([
      "28",
      "36",
      "36",
    ]);
  });

  // A tablet turns every way; a phone stays upright. The manifest's lock is ignored on large screens
  // from Android 16 only, so the activity decides from the screen itself, as it starts.
  it("holds phones in portrait and lets tablets rotate", () => {
    expect(manifest()).not.toContain("screenOrientation");
    const source = kotlin("MainActivity.kt");
    const flat = source.replace(/\s+/g, " ");
    expect(flat).toContain(
      "if (resources.configuration.smallestScreenWidthDp < 600) requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_PORTRAIT",
    );
    const onCreate = source.indexOf("override fun onCreate");
    const end = source.indexOf("override fun onDestroy");
    const lock = source.indexOf("smallestScreenWidthDp < 600");
    expect(lock).toBeGreaterThan(onCreate);
    expect(lock).toBeLessThan(end);
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

  // Below web view 140 the page stops at the system bars and the window's background fills the
  // band behind them: it has to be the page's own, in the light theme and in the dark one.
  it("the band behind the system bars is the page's background in both themes", () => {
    const theme =
      /<style name="AppTheme\.NoActionBar"[^>]*>([\s\S]*?)<\/style>/.exec(
        read("main/res/values/styles.xml"),
      )?.[1] ?? "";
    expect(theme).toContain('<item name="android:windowBackground">@color/launch</item>');
    const launch = (dir: string) =>
      /<color name="launch">(#[0-9A-Fa-f]{6})<\/color>/.exec(
        read(`main/res/${dir}/colors.xml`),
      )?.[1];
    expect([launch("values"), launch("values-night")]).toEqual([
      LAUNCH_BACKGROUND.light,
      LAUNCH_BACKGROUND.dark,
    ]);
  });

  // The system's date picker and dialogs come in Material 3 with Belay's accent, never the
  // wallpaper's colours; the band, the splash and the system bars stay as they were.
  it("the app's theme is Material 3 in Belay's accent, the splash unchanged and Monet off", () => {
    const styles = read("main/res/values/styles.xml");
    const style = (name: string) =>
      new RegExp(`<style name="${name.replace(".", "\\.")}"([^>]*)>([\\s\\S]*?)</style>`).exec(
        styles,
      );
    const theme = style("AppTheme.NoActionBar");
    expect(theme?.[1]).toContain('parent="Theme.Material3.DayNight.NoActionBar"');
    const body = theme?.[2] ?? "";
    expect(body).toContain('<item name="android:windowBackground">@color/launch</item>');
    expect(body).toMatch(/<item name="android:datePickerDialogTheme">@style\/[\w.]+<\/item>/);
    const colour = (dir: string, name: string) =>
      new RegExp(`<color name="${name}">(#[0-9A-Fa-f]{6})</color>`).exec(
        read(`main/res/${dir}/colors.xml`),
      )?.[1] ??
      new RegExp(`<color name="${name}">(#[0-9A-Fa-f]{6})</color>`).exec(
        read("main/res/values/colors.xml"),
      )?.[1];
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");
    const primary = [...css.matchAll(/^\s*--primary: (#[0-9a-f]{6});/gm)].map((m) => m[1]);
    expect(primary).toHaveLength(2);
    for (const item of ["colorPrimary", "android:colorAccent"]) {
      const ref = new RegExp(`<item name="${item}">@color/(\\w+)</item>`).exec(body)?.[1] ?? "";
      expect(
        [colour("values", ref), colour("values-night", ref)].map((c) => c?.toLowerCase()),
        item,
      ).toEqual(primary);
    }
    expect(style("AppTheme.NoActionBarLaunch")?.[0]).toBe(
      `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/launch</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`,
    );
    const sources = join(app, "main/java/cloud/libresoftware/belay");
    for (const file of readdirSync(sources))
      expect(readFileSync(join(sources, file), "utf8"), file).not.toContain("DynamicColors");
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
