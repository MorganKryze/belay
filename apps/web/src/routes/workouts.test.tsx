import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { renderRoute } from "../test/render-route";

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("the Sessions tab", () => {
  it("sits between Home and Body in the tab bar", async () => {
    renderRoute("/workouts");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Home", "Sessions", "Body", "Tools", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Sessions" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("opens on the history, and remembers the segment chosen", async () => {
    renderRoute("/workouts");
    expect(await screen.findByRole("heading", { name: "Sessions", level: 1 })).toBeTruthy();
    expect(
      (screen.getByRole("radio", { name: "History" }) as HTMLButtonElement).dataset.state,
    ).toBe("checked");
    fireEvent.click(screen.getByRole("radio", { name: "Exercises" }));
    expect(await screen.findByRole("searchbox", { name: "Search exercises" })).toBeTruthy();
    cleanup();
    renderRoute("/workouts");
    expect(await screen.findByRole("searchbox", { name: "Search exercises" })).toBeTruthy();
  });

  it("lists the program as cards to see, read only, without an account", async () => {
    renderRoute("/workouts?tab=program");
    const a = await screen.findByRole("region", { name: "Session A · Push" });
    expect(a.textContent).toContain("6 exercises · ~55 min");
    expect(within(a).queryByRole("link", { name: "Start" })).toBeNull();
    const see = within(a).getByRole("button", { name: "See" });
    expect(see.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(see);
    const lateral = within(a).getByRole("link", { name: /Dumbbell lateral raise/ });
    expect(lateral.textContent).toContain("3\u00a0×\u00a012–20 · tri-set");
    expect(lateral.getAttribute("href")).toBe("/exercises/ds%3A0334");
    expect(screen.getByText("The program is edited on a computer.")).toBeTruthy();
  });

  it("says it in French", async () => {
    await i18n.changeLanguage("fr");
    renderRoute("/workouts?tab=program");
    expect(
      await screen.findByRole("region", { name: "Séance C · Fessiers + tirage léger" }),
    ).toBeTruthy();
    expect(screen.getByText("Le programme se modifie sur ordinateur.")).toBeTruthy();
  });
});
