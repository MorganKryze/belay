import { TOOL_IDS } from "../tools/catalog";
import { type Identifier, type Source, SOURCES, sourceById } from "./sources";
import { TOOL_SCIENCE } from "./tools";

// "Reynolds JM" → "Reynolds". Organisations are a single author and stay whole.
const family = (author: string) => author.split(" ")[0]!;

export function shortAuthors(source: Source): string {
  const [first, second] = source.authors;
  if (source.authors.length === 1) return first!;
  if (source.authors.length === 2) return `${family(first!)} & ${family(second!)}`;
  return `${family(first!)} et al.`;
}

export function identifierLabel({ kind, value }: Identifier): string {
  switch (kind) {
    case "doi":
      return `doi:${value}`;
    case "pmid":
      return `PMID ${value}`;
    case "isbn":
      return `ISBN ${value}`;
    case "dtic":
      return `DTIC ${value}`;
    case "report":
      return value;
  }
}

// Only stable resolvers. An ISBN or a report number is shown as text.
export function identifierHref({ kind, value }: Identifier): string | null {
  switch (kind) {
    case "doi":
      return `https://doi.org/${value}`;
    case "pmid":
      return `https://pubmed.ncbi.nlm.nih.gov/${value}/`;
    case "dtic":
      return `https://dtic.mil/docs/citations/${value.replace("-", "")}`;
    default:
      return null;
  }
}

export const hasDoi = (source: Source): boolean => source.identifier.some((i) => i.kind === "doi");

const sentence = (text: string) => (/[.?!]$/.test(text) ? text : `${text}.`);

function referenceLine(source: Source, authors: string): string {
  const ids = source.identifier
    .map((i) => {
      const href = identifierHref(i);
      return href ? `[${identifierLabel(i)}](${href})` : identifierLabel(i);
    })
    .join(" · ");
  const status = hasDoi(source) ? "DOI verified" : "stable identifier, no DOI";
  return `- ${authors} ${source.year}. ${sentence(source.title)} _${source.venue}._ ${ids} (${status} on ${source.verifiedOn})`;
}

const LABELS = {
  source: "Scientific source",
  heuristic: "Belay heuristic",
  mixed: "Scientific source, with a Belay heuristic",
} as const;

// English only: the app shows the same texts in French and English, from the same catalogue.
export function renderScienceDoc(): string {
  const out: string[] = [
    "# The science behind Belay's tools",
    "",
    "Generated from `packages/shared/src/science`. Do not edit by hand: run `pnpm science:doc`.",
    "",
    'Each tool in Belay shows its formula, its sources and its limits. Every reference below was checked against an authoritative record on the date shown. What has no source is labelled "Belay heuristic".',
  ];
  for (const id of TOOL_IDS) {
    const { label, sourceIds, content } = TOOL_SCIENCE[id];
    const c = content.en;
    out.push(
      "",
      `## ${c.title}`,
      "",
      `**Label:** ${LABELS[label]}`,
      "",
      c.brief,
      "",
      "**Keep in mind**",
      "",
    );
    out.push(...c.keep.map((k) => `- ${k}`));
    if (c.heuristic) out.push("", `**Belay heuristic:** ${c.heuristic}`);
    out.push("", "**Formula**", "", ...c.formula.map((f) => `- ${f}`));
    out.push("", "**Limits**", "", ...c.limits.map((l) => `- ${l}`));
    out.push("", "**Sources**", "");
    out.push(...sourceIds.map((s) => referenceLine(sourceById(s), shortAuthors(sourceById(s)))));
  }
  out.push("", "## All verified references", "");
  out.push(...SOURCES.map((s) => referenceLine(s, s.authors.join(", "))));
  return `${out.join("\n")}\n`;
}
