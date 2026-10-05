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
