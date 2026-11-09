// The iPhone app's icon and in-app mark read the web's numbers, so both platforms draw one sign.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { walk } from "@/test/files";
import { oldHooksIn } from "@/test/old-hooks";
import { MARK_SHIFT, MOUNTAIN_D, RING_D, STROKE, TILE_MARK } from "../lib/mark";

const apple = resolve(__dirname, "../../../apple");
const app = join(apple, "Belay");
const iconFile = join(app, "AppIcon.icon");
const read = (path: string) => readFileSync(path, "utf8");

// "#RRGGBB" as the sRGB components Icon Composer writes, three decimals compared.
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(",");
const solid = (value: { solid?: string } | undefined) =>
  (value?.solid ?? "")
    .replace(/^[a-z-]+:/, "")
    .split(",")
    .slice(0, 3)
    .map((n) => Number(n).toFixed(3))
    .join(",");

type Spec = { appearance?: string; value: { solid?: string } };
type Layer = { name: string; "image-name": string; "fill-specializations"?: Spec[] };
const icon = JSON.parse(read(join(iconFile, "icon.json"))) as {
  "fill-specializations": Spec[];
  groups: { layers: Layer[] }[];
  "supported-platforms": Record<string, string>;
};
const fills = (specs: Spec[] | undefined) =>
  Object.fromEntries((specs ?? []).map((s) => [s.appearance ?? "light", solid(s.value)]));
const layers = icon.groups.flatMap((g) => g.layers);
const layer = (name: string) => layers.find((l) => l.name === name);

describe("the iPhone icon", () => {
  it("draws each part on a 1 024 canvas at the tile's offset and scale", () => {
    for (const [name, d] of [
      ["ring", RING_D],
      ["mountain", MOUNTAIN_D],
    ] as const) {
      const svg = read(join(iconFile, "Assets", `${name}.svg`));
      expect(svg).toMatch(/<svg[^>]*width="1024" height="1024" viewBox="0 0 100 100"/);
      expect(svg).toContain(
        `translate(${TILE_MARK.offset} ${TILE_MARK.offset}) scale(${TILE_MARK.scale})`,
      );
      expect(svg).toContain(`translate(${MARK_SHIFT.x} ${MARK_SHIFT.y})`);
      expect(svg).toContain(`d="${d}"`);
      expect(svg).toContain(`stroke-width="${STROKE}"`);
      expect(svg).toContain('stroke-linecap="round"');
      expect(svg).toContain('stroke-linejoin="round"');
      expect(layer(name)?.["image-name"]).toBe(`${name}.svg`);
    }
  });

  it("sits on paper by day and dark paper by night, the parts in their colours", () => {
    expect(fills(icon["fill-specializations"])).toEqual({
      light: rgb("#F3F5F5"),
      dark: rgb("#10151A"),
    });
    expect(fills(layer("ring")?.["fill-specializations"])).toEqual({
      light: rgb("#12181C"),
      dark: rgb("#F3F5F5"),
    });
    expect(fills(layer("mountain")?.["fill-specializations"])).toEqual({
      light: rgb("#1F4E8C"),
      dark: rgb("#8DB6EE"),
    });
    expect(icon["supported-platforms"]).toEqual({ squares: "shared" });
  });

  it("is the one icon source, with no PNG set left", () => {
    expect(existsSync(join(app, "Assets.xcassets/AppIcon.appiconset"))).toBe(false);
    expect(walk(app).filter((p) => /icon[^/]*\.png$/i.test(p))).toEqual([]);
  });
});

describe("the native mark", () => {
  const source = read(join(app, "BelayMark.swift"));
  const points = (d: string) =>
    [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => `CGPoint(x: ${m[1]}, y: ${m[2]})`);

  it("is built from the same numbers, as a ring and a mountain", () => {
    expect(source).toMatch(/nonisolated struct BelayMark: Shape/);
    expect(source).toMatch(/enum Part \{\s*case ring, mountain\s*\}/);
    for (const point of points(MOUNTAIN_D)) expect(source).toContain(point);
    expect(source).toContain("static let radius: CGFloat = 37");
    expect(source).toContain(`static let strokeWidth: CGFloat = ${STROKE}`);
    expect(source).toContain(
      `CGAffineTransform(translationX: ${MARK_SHIFT.x}, y: ${MARK_SHIFT.y})`,
    );
  });

  it("is stroked in the muted colour on the stand-in screen, hidden from VoiceOver", () => {
    const view = read(join(app, "WebForNow.swift"));
    expect(view).toMatch(/BelayMark\(\)\s*\.stroke\(Color\.muted/);
    expect(view).toContain(".accessibilityHidden(true)");
  });

  it("leaves no drawing of the old hooks in the app or its UI tests", () => {
    const found = [app, join(apple, "BelayUITests")]
      .flatMap(walk)
      .filter((p) => /\.(swift|json|svg)$/.test(p))
      .flatMap((p) => oldHooksIn(p, read(p)));
    expect(found).toEqual([]);
  });
});
