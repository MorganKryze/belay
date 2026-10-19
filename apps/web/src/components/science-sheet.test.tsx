import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { ScienceSheet } from "./science-sheet";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

describe("ScienceSheet", () => {
  it("shows the label and the three drawers", () => {
    render(<ScienceSheet toolId="bmi" />);
    expect(screen.getByText("How it's calculated")).toBeTruthy();
    expect(screen.getByText("Scientific source")).toBeTruthy();
    expect(screen.queryByText("Belay heuristic")).toBeNull();
    for (const drawer of ["The formula", "The sources", "The limits in detail"]) {
      expect(screen.getByText(drawer)).toBeTruthy();
    }
    expect(screen.getByText("2 references")).toBeTruthy();
  });

  it("labels a heuristic tool and says what is heuristic", () => {
    render(<ScienceSheet toolId="warmup" />);
    expect(screen.getAllByText("Belay heuristic")).toHaveLength(2); // row label + box title
    expect(screen.queryByText("Scientific source")).toBeNull();
  });

  it("says Source and Belay heuristic on a mixed tool, with no pills", () => {
    const { container } = render(<ScienceSheet toolId="projection" />);
    const summary = container.querySelector("summary")!;
    expect(summary.textContent).toBe("How it's calculated Source and Belay heuristic");
    expect(screen.queryByText("Scientific source")).toBeNull();
    expect(summary.querySelector(".rounded-full")).toBeNull();
  });

  it("the row is the summary, named by its title and its label", () => {
    const { container } = render(<ScienceSheet toolId="bmi" />);
    const summary = container.querySelector("summary")!;
    expect(summary.textContent).toBe("How it's calculated Scientific source");
    expect(summary.querySelector("svg.lucide-info")).toBeTruthy();
    expect(summary.querySelector("svg.lucide-chevron-right")).toBeTruthy();
  });

  it("holds only phrasing content in the summary, as HTML allows there", () => {
    const { container } = render(<ScienceSheet toolId="bmi" />);
    const summary = container.querySelector("summary")!;
    expect(summary.querySelector("div, p, ul, h1, h2, h3, h4, h5, h6")).toBeNull();
  });

  it("opens in place and closes on a second activation", () => {
    const { container } = render(<ScienceSheet toolId="bmi" />);
    const details = container.querySelector("details")!;
    const summary = details.querySelector(":scope > summary")!;
    expect(details.open).toBe(false);
    fireEvent.click(summary);
    expect(details.open).toBe(true);
    expect(details.contains(screen.getByText("In short"))).toBe(true);
    fireEvent.click(summary);
    expect(details.open).toBe(false);
  });

  it("links DOIs and PubMed, and marks a reference without a DOI", () => {
    render(<ScienceSheet toolId="energy" />);
    const doi = screen.getByRole("link", { name: "doi:10.1093/ajcn/51.2.241" });
    expect(doi.getAttribute("href")).toBe("https://doi.org/10.1093/ajcn/51.2.241");
    expect(screen.getByRole("link", { name: "PMID 2305711" }).getAttribute("href")).toBe(
      "https://pubmed.ncbi.nlm.nih.gov/2305711/",
    );
    expect(screen.getByText("ISBN 92-5-105212-3")).toBeTruthy();
    expect(screen.getByText("stable identifier · no DOI")).toBeTruthy();
  });

  it("speaks French", async () => {
    await i18n.changeLanguage("fr");
    render(<ScienceSheet toolId="one-rep-max" />);
    expect(screen.getByText("Comment c'est calculé")).toBeTruthy();
    expect(screen.getByText("C'est une estimation, pas un test.")).toBeTruthy();
  });

  it("says Source et heuristique Belay in French", async () => {
    await i18n.changeLanguage("fr");
    render(<ScienceSheet toolId="projection" />);
    expect(screen.getByText("Source et heuristique Belay")).toBeTruthy();
  });

  it("links a source without a DOI to the record that was read", () => {
    render(<ScienceSheet toolId="energy" />);
    const links = screen.getAllByRole("link", { name: "Record read" });
    expect(links.map((l) => l.getAttribute("href"))).toContain(
      "https://www.fao.org/4/y5686e/y5686e00.htm",
    );
    expect(links.every((l) => l.getAttribute("rel") === "noopener noreferrer")).toBe(true);
  });

  it("discloses a third-party copy, once, on the DoDI only", () => {
    render(<ScienceSheet toolId="body-fat" />);
    expect(screen.getAllByText("Read on a third-party copy, not the official host.")).toHaveLength(
      1,
    );
  });

  it("shows no record link on a DOI-only tool", () => {
    render(<ScienceSheet toolId="one-rep-max" />);
    expect(screen.queryByRole("link", { name: "Record read" })).toBeNull();
    expect(screen.queryByText("Read on a third-party copy, not the official host.")).toBeNull();
  });

  it("speaks French for a regional locale", async () => {
    await i18n.changeLanguage("fr-FR");
    render(<ScienceSheet toolId="one-rep-max" />);
    expect(screen.getByText("C'est une estimation, pas un test.")).toBeTruthy();
  });

  it("takes another title, for a rule rather than a tool", () => {
    render(<ScienceSheet toolId="target-rate" title="How it's chosen" />);
    expect(screen.getByText("How it's chosen")).toBeTruthy();
    expect(screen.queryByText("How it's calculated")).toBeNull();
    expect(screen.getByText("2 references")).toBeTruthy();
  });
});
