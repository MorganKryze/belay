import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";
import { EACH_SET } from "@/test/token-sets";

// The iPhone app's colour sets, held to the stylesheet's tokens: the web draws the values, the
// native app repeats them, and this keeps the two from drifting apart.
const assets = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apple/Belay/Assets.xcassets",
);

type Appearance = { appearance: string; value: string };
type Entry = {
  color: { components: Record<"red" | "green" | "blue", string> };
  appearances?: Appearance[];
};

// Which web set each appearance of a colour set stands for.
function setOf(appearances: Appearance[] = []): string {
  const dark = appearances.some((a) => a.value === "dark");
  const high = appearances.some((a) => a.value === "high");
  return `${high ? "more " : ""}${dark ? "dark" : "light"}`;
}

const hex = (part: string) => Number(part).toString(16).padStart(2, "0");

// A colour set's four values by web set name, as "#rrggbb".
function colourSet(name: string): Record<string, string> {
  const file = join(assets, `${name}.colorset/Contents.json`);
  const { colors } = JSON.parse(readFileSync(file, "utf8")) as { colors: Entry[] };
  return Object.fromEntries(
    colors.map(({ color: { components: c }, appearances }) => [
      setOf(appearances),
      `#${hex(c.red)}${hex(c.green)}${hex(c.blue)}`,
    ]),
  );
}

const DOMAINS = ["session", "body", "activity", "intake", "rest"] as const;
const PARTS = ["tint", "shade"] as const;
const title = (s: string) => s[0]!.toUpperCase() + s.slice(1);

describe("native domain colours", () => {
  it.each(DOMAINS.flatMap((d) => PARTS.map((p) => [d, p] as const)))(
    "%s %s holds the web token in each of the four sets",
    (domain, part) => {
      const native = colourSet(`${title(domain)}${title(part)}`);
      const web = Object.fromEntries(EACH_SET.map(([set, t]) => [set, t[`${domain}-${part}`]]));
      expect(native).toEqual(web);
    },
  );

  it.each(["light", "dark", "more light", "more dark"])(
    "%s reads each shade on the app's paper, its surface and the shade's own tint",
    (set) => {
      const min = set.startsWith("more") ? 7 : 4.5;
      const grounds = [colourSet("Paper")[set]!, colourSet("Surface")[set]!];
      for (const d of DOMAINS) {
        const shade = colourSet(`${title(d)}Shade`)[set]!;
        const tint = colourSet(`${title(d)}Tint`)[set]!;
        for (const ground of [...grounds, tint]) {
          const ratio = contrastRatio(shade, ground);
          expect(ratio, `${d} on ${ground}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
        }
      }
    },
  );
});
