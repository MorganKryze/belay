import { TOOL_SCIENCE } from "@belay/shared/science/tools";
import { describe, expect, it } from "vitest";
import mainEn from "./en.json";
import mainFr from "./fr.json";
import { detectLocale } from "./index";
import lazyEn from "./lazy/en.json";
import lazyFr from "./lazy/fr.json";

const keys = (o: object, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`],
  );
// Each language as the app ends up with it: the initial strings, then those loaded on demand.
const merge = (a: object, b: object): object => {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = typeof v === "object" && v !== null && k in out ? merge(out[k] as object, v) : v;
  return out;
};
const en = merge(mainEn, lazyEn);
const fr = merge(mainFr, lazyFr);

describe("detectLocale", () => {
  it.each([
    [null, ["fr-FR", "en"], "fr"],
    [null, ["fr-CA"], "fr"],
    [null, ["de-DE", "fr"], "fr"],
    [null, ["de-DE"], "en"],
    [null, [], "en"],
    ["en", ["fr-FR"], "en"],
    ["xx", ["fr-FR"], "fr"],
  ] as const)("stored %s, preferred %j → %s", (stored, preferred, expected) => {
    expect(detectLocale(stored, preferred)).toBe(expected);
  });
});

describe("translations", () => {
  it("have exactly the same keys in every language", () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort());
  });

  it("keep each key in one file only: a string loaded on demand never replaces another", () => {
    expect(keys(lazyEn).filter((k) => keys(mainEn).includes(k))).toEqual([]);
    expect(keys(lazyFr).filter((k) => keys(mainFr).includes(k))).toEqual([]);
  });

  it("never judges a body", () => {
    const judging = /sain|surpoids|obèse|healthy|overweight|obese/i;
    const strings = (o: object): string[] =>
      Object.values(o).flatMap((v) =>
        typeof v === "object" && v !== null ? strings(v) : [String(v)],
      );
    expect([...strings(en), ...strings(fr)].filter((s) => judging.test(s))).toEqual([]);
  });

  it("sets French punctuation after a narrow no-break space, never a plain one", () => {
    const strings = (o: object): string[] =>
      Object.values(o).flatMap((v) =>
        typeof v === "object" && v !== null ? strings(v) : [String(v)],
      );
    const science = Object.values(TOOL_SCIENCE).flatMap((t) => strings(t.content.fr));
    expect([...strings(fr), ...science].filter((s) => /[^\s] [:;?!%»]|« /.test(s))).toEqual([]);
  });
});
