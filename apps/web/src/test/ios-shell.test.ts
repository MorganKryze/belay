// What the iPhone and iPad shell must keep so the page behaves as it does in the browser: the
// system's own look, the device families, the launch screen and the rubber-band at the page's ends.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { swift } from "./swift";

const mobile = join(dirname(fileURLToPath(import.meta.url)), "../../../mobile");
const plists = ["App/Info.plist", "BelayActivity/Info.plist"].map((p) => swift(p));
const appPlist = plists[0]!;
const project = swift("App.xcodeproj/project.pbxproj");
const storyboard = swift("App/Base.lproj/LaunchScreen.storyboard");

// The array of strings under a plist key.
const strings = (plist: string, key: string): string[] => {
  const block = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(plist)?.[1];
  return [...(block ?? "").matchAll(/<string>(\w+)<\/string>/g)].map((m) => m[1]!);
};

describe("the iOS shell", () => {
  it("keeps the system's own look instead of opting out of it", () => {
    for (const plist of plists) expect(plist).not.toContain("UIDesignRequiresCompatibility");
  });

  it("builds for iOS 16.4 and later everywhere", () => {
    const targets = project.match(/IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g) ?? [];
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets)).toEqual(new Set(["IPHONEOS_DEPLOYMENT_TARGET = 16.4;"]));
  });

  it("runs on iPhone and iPad, the widget extension staying on iPhone", () => {
    const families = (id: string) =>
      [
        ...project.matchAll(
          new RegExp(`${id}[^;]*;[\\s\\S]*?TARGETED_DEVICE_FAMILY = ([^;]+);`, "g"),
        ),
      ].map((m) => m[1]);
    expect(families("INFOPLIST_FILE = App/Info.plist")).toEqual(['"1,2"', '"1,2"']);
    expect(families("INFOPLIST_FILE = BelayActivity/Info.plist")).toEqual(["1", "1"]);
  });

  it("fills the iPad screen and turns with it", () => {
    expect(appPlist).not.toContain("UIRequiresFullScreen");
    expect(strings(appPlist, "UISupportedInterfaceOrientations")).toEqual([
      "UIInterfaceOrientationPortrait",
    ]);
    expect(strings(appPlist, "UISupportedInterfaceOrientations~ipad").sort()).toEqual([
      "UIInterfaceOrientationLandscapeLeft",
      "UIInterfaceOrientationLandscapeRight",
      "UIInterfaceOrientationPortrait",
      "UIInterfaceOrientationPortraitUpsideDown",
    ]);
  });

  it("shows a launch screen", () => {
    expect(appPlist).toMatch(/<key>UILaunchStoryboardName<\/key>\s*<string>LaunchScreen<\/string>/);
  });

  it("does not preview a link on a long press", () => {
    const config = JSON.parse(readFileSync(join(mobile, "capacitor.config.json"), "utf8")) as {
      ios?: { allowsLinkPreview?: boolean };
    };
    expect(config.ios?.allowsLinkPreview).toBe(false);
  });

  it("brings the bounce back once the bridge exists", () => {
    const source = swift("App/BelayNative.swift");
    const start = source.indexOf("func capacitorDidLoad()");
    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, source.indexOf("\n    }", start))).toContain(
      "webView?.scrollView.bounces = true",
    );
  });

  // The edge swipe is the web view's own back gesture: off as the shell starts, and turned on or
  // off only by the page, which alone knows whether a pushed page is on top.
  it("leaves the edge swipe off until the page turns it on", () => {
    const sources = readdirSync(join(mobile, "ios/App/App"))
      .filter((f) => f.endsWith(".swift"))
      .map((f) => swift(`App/${f}`));
    const native = swift("App/BelayNative.swift");
    const assigned = sources.flatMap((s) => [
      ...s.matchAll(/allowsBackForwardNavigationGestures\s*=\s*([^\n]+)/g),
    ]);
    expect(assigned.map((m) => m[1]!.trim())).toEqual(["enabled"]);
    expect(native).not.toMatch(/allowsBackForwardNavigationGestures\s*=\s*true/);
    const start = native.indexOf("@objc func setSwipeBack(_ call: CAPPluginCall)");
    expect(start).toBeGreaterThan(-1);
    const method = native.slice(start, native.indexOf("\n    }", start));
    expect(method).toContain("allowsBackForwardNavigationGestures = enabled");
    expect(method).toContain("bridge?.webView");
    expect(method).toContain("DispatchQueue.main.async");
    expect(method).toMatch(
      /guard let enabled = call\.getBool\("enabled"\) else \{\s*return call\.reject\(/,
    );
    expect(native).toContain(
      'CAPPluginMethod(name: "setSwipeBack", returnType: CAPPluginReturnPromise)',
    );
  });

  // The launch screen carries the page's own: the mark alone, 112 wide, centred on the view.
  it("draws the launch mark 112 wide, centred on the view, with no margin", () => {
    const image = /<imageView [^>]*image="LaunchMark"[^>]*id="([^"]+)"/.exec(storyboard);
    expect(image).not.toBeNull();
    const id = image![1]!;
    const constraints = [...storyboard.matchAll(/<constraint [^>]*\/>/g)].map((m) => m[0]);
    const on = (attribute: string) =>
      constraints.filter(
        (c) => c.includes(`firstItem="${id}"`) && c.includes(`firstAttribute="${attribute}"`),
      );
    expect(on("width").some((c) => c.includes('constant="112"'))).toBe(true);
    expect(on("centerX").join()).toContain('secondItem="snD-IY-ifK"');
    expect(on("centerY").join()).toContain('secondItem="snD-IY-ifK"');
    for (const edge of ["leading", "trailing", "top", "bottom"]) expect(on(edge)).toEqual([]);
  });

  // The shell keeps its own launch until the native app replaces it, so these are its colours,
  // the page's before the cool palette, and no longer the page's.
  it("keeps its own launch background in both themes", () => {
    const set = JSON.parse(
      swift("App/Assets.xcassets/LaunchBackground.colorset/Contents.json"),
    ) as {
      colors: { appearances?: unknown[]; color: { components: Record<string, string> } }[];
    };
    const hex = (c: (typeof set.colors)[number]) =>
      "#" +
      ["red", "green", "blue"].map((k) => c.color.components[k]!.slice(2).toUpperCase()).join("");
    const light = set.colors.find((c) => !c.appearances)!;
    const dark = set.colors.find((c) => c.appearances)!;
    expect([hex(light), hex(dark)]).toEqual(["#FAFAF7", "#151412"]);
  });
});
