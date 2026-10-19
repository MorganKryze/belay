import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { renderRoute } from "../test/render-route";

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("tools", () => {
  it("lists the eight tools in three groups", async () => {
    renderRoute("/tools");
    expect(await screen.findByRole("heading", { name: "Tools", level: 1 })).toBeTruthy();
    for (const group of ["Strength", "Energy", "Body"]) {
      expect(screen.getByRole("heading", { name: group, level: 2 })).toBeTruthy();
    }
    const links = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/tools/"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/tools/one-rep-max",
      "/tools/plates",
      "/tools/warmup",
      "/tools/energy",
      "/tools/protein",
      "/tools/projection",
      "/tools/bmi",
      "/tools/body-fat",
    ]);
  });

  it("lists three sections of tools, each a list under its label", async () => {
    renderRoute("/tools");
    await screen.findByRole("heading", { name: "Tools", level: 1 });
    const expected = {
      Strength: ["one-rep-max", "plates", "warmup"],
      Energy: ["energy", "protein", "projection"],
      Body: ["bmi", "body-fat"],
    };
    for (const [group, tools] of Object.entries(expected)) {
      const section = screen.getByRole("region", { name: group });
      const list = within(section).getByRole("list");
      // Each link in turn, read by its accessible name: the tool's name then its hint.
      const links = within(list).getAllByRole("link");
      expect(links).toHaveLength(tools.length);
      tools.forEach((id, i) => {
        const name = `${i18n.t(`tools.items.${id}.name`)} ${i18n.t(`tools.items.${id}.hint`)}`;
        expect(within(list).getByRole("link", { name })).toBe(links[i]);
      });
    }
  });

  it("each tool is a link named by its name then its hint", async () => {
    renderRoute("/tools");
    await screen.findByRole("heading", { name: "Tools", level: 1 });
    for (const id of ["one-rep-max", "plates", "bmi", "body-fat"]) {
      const name = i18n.t(`tools.items.${id}.name`);
      const hint = i18n.t(`tools.items.${id}.hint`);
      const link = screen.getByRole("link", { name: `${name} ${hint}` });
      expect(link.getAttribute("href")).toBe(`/tools/${id}`);
    }
  });

  it("the lead is the page's last paragraph, after the lists", async () => {
    renderRoute("/tools");
    const h1 = await screen.findByRole("heading", { name: "Tools", level: 1 });
    const page = h1.closest("section")!;
    const lead = within(page).getByText(i18n.t("tools.lead"));
    expect(lead.tagName).toBe("P");
    expect(lead.closest("header")).toBeNull();
    expect(page.lastElementChild).toBe(lead);
    const lists = within(page).getAllByRole("list");
    for (const list of lists) {
      expect(list.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(list.getAttribute("aria-describedby")).toBeNull();
    }
  });

  it("1RM and BMI draw weight and gauge, never Séances' dumbbell or Corps' ruler", async () => {
    renderRoute("/tools");
    await screen.findByRole("heading", { name: "Tools", level: 1 });
    const svg = (name: string) =>
      screen.getByRole("link", { name: new RegExp(`^${name} `) }).querySelector("svg");
    expect(svg("One-rep max")?.classList.contains("lucide-weight")).toBe(true);
    expect(svg("BMI")?.classList.contains("lucide-gauge")).toBe(true);
    expect(screen.getByRole("main").querySelector(".lucide-dumbbell, .lucide-ruler")).toBeNull();
  });

  it("tool rows tint on press", async () => {
    renderRoute("/tools");
    await screen.findByRole("heading", { name: "Tools", level: 1 });
    const rows = screen
      .getAllByRole("link")
      .filter((a) => a.getAttribute("href")?.startsWith("/tools/"));
    for (const row of rows) expect(row.className).toContain("press-tint");
  });

  it("marks the Tools tab as current on a tool page", async () => {
    renderRoute("/tools/bmi");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Tools" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(nav).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("shows the localized not-found screen for an unknown tool or path", async () => {
    renderRoute("/tools/nope");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
    cleanup();
    await i18n.changeLanguage("fr");
    renderRoute("/nowhere");
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeTruthy();
  });
});

describe("navigation", () => {
  it("leaves focus alone on first load, then moves it to the new h1", async () => {
    const router = renderRoute("/tools");
    const first = await screen.findByRole("heading", { name: "Tools", level: 1 });
    expect(document.activeElement === first).toBe(false);
    await act(async () => {
      void router.navigate({ to: "/tools/$toolId", params: { toolId: "bmi" } });
    });
    const h1 = await screen.findByRole("heading", { name: "BMI", level: 1 });
    await waitFor(() => expect(document.activeElement === h1).toBe(true));
    expect(h1.getAttribute("tabindex")).toBe("-1");
  });
});
