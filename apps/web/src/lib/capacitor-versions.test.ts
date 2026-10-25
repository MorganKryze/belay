import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The web app calls the plugins' JavaScript side and the iPhone project links their native side:
// two versions of one plugin would talk past each other, so both packages pin the same release.
const apps = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function capacitorPins(app: string): Record<string, string> {
  const manifest = JSON.parse(readFileSync(join(apps, app, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return Object.fromEntries(
    Object.entries(manifest.dependencies ?? {}).filter(([name]) => name.startsWith("@capacitor/")),
  );
}

describe("Capacitor versions", () => {
  it("the web app and the iPhone project pin the same Capacitor versions, exactly", () => {
    const web = capacitorPins("web");
    const ios = capacitorPins("ios");
    expect(Object.keys(web)).toEqual(
      expect.arrayContaining([
        "@capacitor/core",
        "@capacitor/local-notifications",
        "@capacitor/haptics",
      ]),
    );
    for (const [name, version] of Object.entries(web)) {
      expect([name, ios[name]]).toEqual([name, version]);
    }
    for (const [name, version] of Object.entries({ ...web, ...ios })) {
      expect([name, version]).toEqual([name, expect.stringMatching(/^\d+\.\d+\.\d+$/)]);
    }
  });
});
