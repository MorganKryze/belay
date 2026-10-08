import { describe, expect, it } from "vitest";
import { hasDoi, identifierHref, identifierLabel, renderScienceDoc, shortAuthors } from "./render";
import { SOURCES, sourceById } from "./sources";
import { SCIENCE_IDS, TOOL_SCIENCE } from "./tools";

const sentences = (text: string) => text.match(/[.!?](?=\s|$)/g)?.length ?? 0;

describe("sources", () => {
  it("holds exactly the 26 verified references, each with a unique id", () => {
    expect(SOURCES).toHaveLength(26);
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(26);
  });

  it("gives every reference at least one identifier and a link", () => {
    for (const s of SOURCES) {
      expect(s.identifier.length, s.id).toBeGreaterThan(0);
      expect(s.url, s.id).toMatch(/^https:\/\//);
    }
  });

  it("leaves the unverified items out", () => {
    const text = JSON.stringify(SOURCES);
    expect(text).not.toMatch(/Poundage chart|Epley/);
    expect(text).not.toMatch(/1\.375|1\.725/);
    expect(text).not.toMatch(/chrome/i);
  });

  it("formats authors and identifiers", () => {
    expect(shortAuthors(sourceById("reynolds-2006"))).toBe("Reynolds et al.");
    expect(shortAuthors(sourceById("hodgdon-friedl-1999"))).toBe("Hodgdon & Friedl");
    expect(shortAuthors(sourceById("hall-2008"))).toBe("Hall KD");
    expect(shortAuthors(sourceById("fao-2004"))).toBe("Joint FAO/WHO/UNU Expert Consultation");
    expect(identifierLabel({ kind: "doi", value: "10.1519/R-15304.1" })).toBe(
      "doi:10.1519/R-15304.1",
    );
    expect(identifierHref({ kind: "doi", value: "10.1519/R-15304.1" })).toBe(
      "https://doi.org/10.1519/R-15304.1",
    );
    expect(identifierHref({ kind: "pmid", value: "16937972" })).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/16937972/",
    );
    expect(identifierHref({ kind: "dtic", value: "AD-A143890" })).toBe(
      "https://dtic.mil/docs/citations/ADA143890",
    );
    expect(identifierHref({ kind: "isbn", value: "92-5-105212-3" })).toBeNull();
    expect(hasDoi(sourceById("fao-2004"))).toBe(false);
    expect(hasDoi(sourceById("hodgdon-friedl-1999"))).toBe(true);
  });
});

describe("tool science", () => {
  it("covers every tool and the profile's loss range", () => {
    expect(Object.keys(TOOL_SCIENCE).sort()).toEqual([...SCIENCE_IDS].sort());
    expect(SCIENCE_IDS).toContain("target-rate");
  });

  it.each(SCIENCE_IDS)("%s: cites only known sources", (id) => {
    const known = new Set<string>(SOURCES.map((s) => s.id));
    for (const s of TOOL_SCIENCE[id].sourceIds) expect(known.has(s), s).toBe(true);
    expect(TOOL_SCIENCE[id].sourceIds.length).toBeGreaterThan(0);
  });

  it.each(SCIENCE_IDS)("%s: French and English say the same amount", (id) => {
    const { fr, en } = TOOL_SCIENCE[id].content;
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    expect(fr.keep.length).toBe(en.keep.length);
    expect(fr.formula.length).toBe(en.formula.length);
    expect(fr.limits.length).toBe(en.limits.length);
  });

  it.each(SCIENCE_IDS)("%s: brief of 2–3 sentences, at most 3 bullets, no empty text", (id) => {
    for (const c of Object.values(TOOL_SCIENCE[id].content)) {
      expect(sentences(c.brief)).toBeGreaterThanOrEqual(2);
      expect(sentences(c.brief)).toBeLessThanOrEqual(3);
      expect(c.keep.length).toBeGreaterThan(0);
      expect(c.keep.length).toBeLessThanOrEqual(3);
      for (const line of [c.title, ...c.keep, ...c.formula, ...c.limits]) {
        expect(line.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it.each(SCIENCE_IDS)("%s: says what is heuristic exactly when the label says so", (id) => {
    const { label, content } = TOOL_SCIENCE[id];
    for (const c of Object.values(content))
      expect(c.heuristic !== undefined).toBe(label !== "source");
  });

  it("cites Epley only as reproduced in Reynolds 2006", () => {
    const { fr, en } = TOOL_SCIENCE["one-rep-max"].content;
    expect(fr.formula.join(" ")).toContain("tel que reproduit dans Reynolds 2006");
    expect(en.formula.join(" ")).toContain("as reproduced in Reynolds 2006");
  });

  it("sources the loss range on Helms 2014, with Garthe 2011 worded as the source shows", () => {
    const { label, sourceIds, content } = TOOL_SCIENCE["target-rate"];
    expect(label).toBe("source");
    expect(sourceIds).toEqual(["helms-2014-jissn", "garthe-2011"]);
    // The softened wording ruled in M1: what Garthe measured, not a warning it did not give.
    expect(content.fr.keep).toContain(TOOL_SCIENCE.projection.content.fr.keep[1]);
    expect(content.en.keep).toContain(TOOL_SCIENCE.projection.content.en.keep[1]);
  });

  it("keeps Helms' cut range per kg of lean mass", () => {
    expect(TOOL_SCIENCE.protein.content.en.formula.join(" ")).toContain(
      "2.3 to 3.1 g per kg of lean mass",
    );
  });
});

describe("renderScienceDoc", () => {
  it("lists every tool and every reference", () => {
    const doc = renderScienceDoc();
    for (const id of SCIENCE_IDS) expect(doc).toContain(`## ${TOOL_SCIENCE[id].content.en.title}`);
    for (const s of SOURCES) expect(doc).toContain(s.title);
    expect(doc.endsWith("\n")).toBe(true);
  });

  it("links the references without a DOI and flags the third-party copy", () => {
    const doc = renderScienceDoc();
    for (const id of ["fao-2004", "who-trs-894", "dodi-1308-3", "iwf-tcrr-2020"] as const)
      expect(doc).toContain(`[Record read](${sourceById(id).url})`);
    expect(doc).toContain("Read on a third-party copy");
  });
});
