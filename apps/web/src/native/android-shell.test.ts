import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LAUNCH_SAFETY_MS } from "@/lib/launch";
import { kotlin, longConst, stringSet } from "@/test/kotlin";

// The Android project's shape, read from its sources: the plugin the page calls, and what the
// manifest and the network rules let out of the phone.
const app = join(dirname(fileURLToPath(import.meta.url)), "../../../mobile/android/app/src");
const read = (path: string) => readFileSync(join(app, path), "utf8");
const manifest = () => read("main/AndroidManifest.xml");
// The app's colours, light then dark: the launch papers, the accent and the sheet surface. The
// shell's resources must carry the same values as the page, or the handover shows a step.
const PAPER = ["#F3F5F5", "#10151A"];
const ACCENT = ["#1F4E8C", "#8DB6EE"];
const SURFACE = ["#FFFFFF", "#182027"];
// A colour's value in the light and the night resources.
const colours = (name: string) =>
  ["values", "values-night"].map((dir) =>
    new RegExp(`<color name="${name}">(#[0-9A-Fa-f]{6})</color>`)
      .exec(read(`main/res/${dir}/colors.xml`))?.[1]
      ?.toUpperCase(),
  );
const kotlinFiles = () => {
  const dir = join(app, "main/java/cloud/libresoftware/belay");
  return readdirSync(dir).filter((f) => f.endsWith(".kt"));
};
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

  it("the plugin answers to BelayNative with the page's seven methods", () => {
    const source = kotlin("BelayNativePlugin.kt");
    expect(source).toContain('@CapacitorPlugin(name = "BelayNative")');
    const methods = [...source.matchAll(/@PluginMethod\s+fun (\w+)\(/g)].map((m) => m[1]!).sort();
    expect(pageMethods()).toHaveLength(7);
    expect(methods).toEqual(pageMethods());
  });

  // The edge swipe is the iPhone's; Android's Back asks the page by its own path, so the call
  // only answers, should it ever arrive.
  it("answers the iPhone's edge swipe call and does nothing with it", () => {
    expect(kotlin("BelayNativePlugin.kt").replace(/\s+/g, " ")).toContain(
      "@PluginMethod fun setSwipeBack(call: PluginCall) = call.resolve()",
    );
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
    expect(load).toContain("bridge.webView.addJavascriptInterface(");
    expect(load).toContain('"BelayText"');
    expect(source).toContain("@JavascriptInterface fun scale(): Float = scale");
    const init = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../public/theme-init.js"),
      "utf8",
    );
    expect(init).toContain("globalThis.BelayText?.scale()");
    expect(manifest()).not.toMatch(/android:configChanges="[^"]*fontScale/);
  });

  // The page reads increased contrast from the shell, at call time so a change shows on the next
  // read; the object offers the two readings and nothing else, so the bridge keeps a fixed shape.
  it("BelayText offers scale() and contrast() and reads the contrast when asked", () => {
    const source = kotlin("BelayNativePlugin.kt").replace(/\s+/g, " ");
    const tail = source.slice(source.indexOf("class TextScale"));
    const exposed = [...tail.matchAll(/@JavascriptInterface fun (\w+)\(\): (\w+)/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(exposed).toEqual([
      ["scale", "Float"],
      ["contrast", "Boolean"],
    ]);
    expect(tail).toContain("fun contrast(): Boolean = contrast()");
    const rule = kotlin("Contrast.kt").replace(/\s+/g, " ");
    expect(rule).toContain(
      "internal fun isHighContrast(contrast: Float, highText: Boolean): Boolean",
    );
    expect(rule).toContain("highText || contrast > 0.25f");
    // The contrast reading stays a few lines: native code is kept small and never grows per screen.
    expect(kotlin("Contrast.kt").split("\n").length).toBeLessThan(40);
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
    expect(colours("launch")).toEqual(PAPER);
  });

  // Android's splash leaves on the activity's first frame, long before the page draws: the web
  // view's own white filled the gap. The splash now holds the activity until the page has loaded,
  // its launch screen in it, and then stays over the activity until the web view has drawn that
  // screen: a web view that has not drawn yet shows its bare background, paper with no mark. A
  // page that never draws lets the splash go at the page's own safety delay.
  it("the splash stays until the web view has drawn the page's launch screen", () => {
    const source = kotlin("MainActivity.kt");
    const flat = source.replace(/\s+/g, " ");
    const hold = flat.indexOf("splash.setKeepOnScreenCondition { !loaded }");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(flat.indexOf("super.onCreate"));
    expect(flat).toContain("bridge.webView.setBackgroundColor(getColor(R.color.launch))");
    // Loaded, not merely committed: a committed page may not have parsed its launch screen yet.
    expect(flat).toContain("override fun onPageLoaded(webView: WebView) { loaded = true }");
    expect(flat).not.toContain("onPageCommitVisible");
    // One cap for both holds, counted from the activity's start: 4 s at most, not 4 s twice.
    expect(flat).toContain("val start = SystemClock.uptimeMillis()");
    expect(flat).toContain(
      "Handler(Looper.getMainLooper()).postAtTime({ loaded = true }, start + SPLASH_MS)",
    );
    // Over the activity, the splash goes once the web view's frame is on screen, or at the cap.
    const exit = flat.slice(flat.indexOf("splash.setOnExitAnimationListener { provider ->"));
    expect(exit.length).toBeLessThan(flat.length);
    expect(exit).toMatch(
      /postVisualStateCallback\(.*postOnAnimation \{ web\.postOnAnimation\(remove\) \}/,
    );
    expect(exit).toContain("Handler(Looper.getMainLooper()).postAtTime(remove, start + SPLASH_MS)");
    expect(flat).not.toContain("postDelayed");
    expect(exit.indexOf("provider.remove()")).toBeGreaterThan(-1);
    expect(longConst(source, "SPLASH_MS")).toBe(LAUNCH_SAFETY_MS);
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
    for (const item of ["colorPrimary", "android:colorAccent"])
      expect(body, item).toContain(`<item name="${item}">@color/accent</item>`);
    expect(colours("accent")).toEqual(ACCENT);
    expect(style("AppTheme.NoActionBarLaunch")?.[0]).toBe(
      `<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="windowSplashScreenBackground">@color/launch</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/ic_splash_mark</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`,
    );
    const sources = join(app, "main/java/cloud/libresoftware/belay");
    for (const file of readdirSync(sources))
      expect(readFileSync(join(sources, file), "utf8"), file).not.toContain("DynamicColors");
  });

  // The web view opens the framework's date picker in this overlay. Each part reads its own
  // attribute, measured on the emulator with one colour per attribute: the header in light reads
  // android:colorAccent and in dark the picker style's header, the chosen day
  // android:colorControlActivated, the buttons colorPrimary and the sheet colorSurface. Material 3
  // fills the last two from its baseline purple unless they are set.
  it("the date picker takes Belay's accent and surface in both themes", () => {
    const styles = read("main/res/values/styles.xml");
    const style = (name: string) =>
      new RegExp(`<style name="${name.replaceAll(".", "\\.")}"([^>]*)>([\\s\\S]*?)</style>`).exec(
        styles,
      );
    const item = (body: string, name: string) =>
      new RegExp(`<item name="${name}">@(\\w+)/([\\w.]+)</item>`).exec(body)?.slice(1);
    const overlayName =
      item(style("AppTheme.NoActionBar")?.[2] ?? "", "android:datePickerDialogTheme")?.[1] ?? "";
    const overlay = style(overlayName)?.[2] ?? "";
    for (const name of ["android:colorAccent", "android:colorControlActivated", "colorPrimary"])
      expect(item(overlay, name), name).toEqual(["color", "accent"]);
    expect(item(overlay, "colorSurface")).toEqual(["color", "surface"]);
    const pickerName = item(overlay, "android:datePickerStyle")?.[1] ?? "";
    const picker = style(pickerName);
    expect(picker?.[1]).toContain('parent="@android:style/Widget.Material.DatePicker"');
    expect(item(picker?.[2] ?? "", "android:headerBackground")).toEqual(["color", "accent"]);

    expect(colours("accent")).toEqual(ACCENT);
    expect(colours("surface")).toEqual(SURFACE);
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
  // The old orange family and warm neutrals are in no colour resource, style or Kotlin file, so
  // no surface of the app falls back to the former palette.
  it("keeps no colour of the old palette in the values, the styles or the Kotlin", () => {
    const old = /#(fafaf7|151412|c2410c|fb923c|ea580c|1d1b19)\b/i;
    for (const dir of ["values", "values-night"])
      expect(read(`main/res/${dir}/colors.xml`)).not.toMatch(old);
    expect(read("main/res/values/styles.xml")).not.toMatch(old);
    for (const file of kotlinFiles()) expect(kotlin(file), file).not.toMatch(old);
  });

  // The splash draws its own mark in the launch blue, never the launcher's paper foreground, so
  // the mark keeps one colour from the first frame to the page.
  it("the splash draws ic_splash_mark in the launch blue on the two papers", () => {
    const launch = /<style name="AppTheme\.NoActionBarLaunch"[^>]*>([\s\S]*?)<\/style>/.exec(
      read("main/res/values/styles.xml"),
    )?.[1];
    expect(launch).toContain(
      '<item name="windowSplashScreenAnimatedIcon">@drawable/ic_splash_mark</item>',
    );
    expect(launch).toContain('<item name="windowSplashScreenBackground">@color/launch</item>');
    const mark = read("main/res/drawable/ic_splash_mark.xml");
    expect(mark).toContain("M86 160L86 266A120 120 0 0 0 326 266");
    expect(mark).toContain('android:fillColor="@color/accent"');
    expect(mark).not.toContain("@color/launch");
    expect(colours("accent")).toEqual(["#1F4E8C", "#8DB6EE"]);
    expect(colours("launch")).toEqual(PAPER);
  });

  // The adaptive icon sits on the blue by day and dark paper by night; the themed layer stays so
  // the launcher can draw its monochrome icon.
  it("the adaptive icon has the icon ground, a night foreground and the monochrome layer", () => {
    expect(colours("icon_ground")).toEqual(["#1F4E8C", "#10151A"]);
    for (const icon of ["ic_launcher", "ic_launcher_round"]) {
      const xml = read(`main/res/mipmap-anydpi-v26/${icon}.xml`);
      expect(xml).toContain('<background android:drawable="@color/icon_ground" />');
      expect(xml).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground" />');
      expect(xml).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome" />');
    }
    for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"])
      for (const layer of ["foreground", "monochrome"])
        expect(existsSync(join(app, `main/res/mipmap-${density}/ic_launcher_${layer}.png`))).toBe(
          true,
        );
    for (const density of ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"])
      expect(
        existsSync(join(app, `main/res/mipmap-night-${density}/ic_launcher_foreground.png`)),
      ).toBe(true);
  });

  // The status bar icon stays the white mark: Android draws status icons as a white silhouette.
  it("the status bar icon stays white and the notifier tints the Live Update with the accent", () => {
    const script = readFileSync(join(app, "../../../../../scripts/gen-icons.sh"), "utf8");
    const stat = script.split("\n").find((line) => line.includes('fill="#FFFFFF" transform'));
    expect(stat).toContain('width="24"');
    expect(kotlin("SessionNotifier.kt")).toContain(
      ".setColor(ContextCompat.getColor(context, R.color.accent))",
    );
  });
});
