import { describe, expect, it } from "vitest";
import en from "./en.json";
import fr from "./fr.json";
import lazyEn from "./lazy/en.json";
import lazyFr from "./lazy/fr.json";

// A number and its unit stay on one line: a no-break space, never a plain one.
const plain = /(\d|\}\}) (kg|lb|kcal|g|cm|min)(?![\p{L}])/u;

function strings(value: unknown, path = ""): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => strings(v, `${path}.${k}`));
  return [];
}

describe("unit spacing in the catalogues", () => {
  for (const [name, catalogue] of Object.entries({ en, fr, lazyEn, lazyFr })) {
    it(`${name} has no plain space before a unit`, () => {
      const bad = strings(catalogue).filter(([, s]) => plain.test(s));
      expect(bad).toEqual([]);
    });
  }
});
