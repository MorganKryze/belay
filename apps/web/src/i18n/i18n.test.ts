import { describe, expect, it } from "vitest";
import en from "./en.json";
import fr from "./fr.json";
import { detectLocale } from "./index";

const keys = (o: object, p = ""): string[] =>
  Object.entries(o).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? keys(v, `${p}${k}.`) : [`${p}${k}`],
  );

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
    expect(strings(fr).filter((s) => /[^\s] [:;?!%»]|« /.test(s))).toEqual([]);
  });
});
