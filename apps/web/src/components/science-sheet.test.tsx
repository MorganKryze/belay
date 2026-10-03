import { cleanup, render, screen } from "@testing-library/react";
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
    expect(screen.getAllByText("Belay heuristic")).toHaveLength(2); // pill + box title
    expect(screen.queryByText("Scientific source")).toBeNull();
  });

  it("shows both labels on a mixed tool", () => {
    render(<ScienceSheet toolId="projection" />);
    expect(screen.getByText("Scientific source")).toBeTruthy();
    expect(screen.getAllByText("Belay heuristic").length).toBeGreaterThan(0);
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
});
