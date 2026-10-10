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

  it("lists the program read only, the first session open and its groups marked", async () => {
    renderRoute("/workouts?tab=program");
    const a = await screen.findByRole("button", { name: /Session A · Push/ });
    expect(a.getAttribute("aria-expanded")).toBe("true");
    expect(a.textContent).toContain("6 exercises");
    const lateral = screen.getByRole("link", { name: /Dumbbell lateral raise/ });
    expect(lateral.textContent).toContain("3 × 12–20 · tri-set");
    expect(lateral.getAttribute("href")).toBe("/exercises/ds%3A0334");
    const b = screen.getByRole("button", { name: /Session B · Legs/ });
    expect(b.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(b);
    expect(screen.getByRole("link", { name: /Lever lying leg curl/ }).textContent).toContain(
      "superset",
    );
    expect(screen.getByText("The program is edited on a computer.")).toBeTruthy();
  });

  it("says it in French", async () => {
    await i18n.changeLanguage("fr");
    renderRoute("/workouts?tab=program");
    expect(
      await screen.findByRole("button", { name: /Séance C · Fessiers \+ tirage léger/ }),
    ).toBeTruthy();
    expect(screen.getByText("Le programme se modifie sur ordinateur.")).toBeTruthy();
  });
});
