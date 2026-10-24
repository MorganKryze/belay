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
    ).toEqual(["Home", "Sessions", "Body", "Tools"]);
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

  it("lists the program as cards that open their preview, without an account", async () => {
    renderRoute("/workouts?tab=program");
    // Nothing is next without an account: every card is a link to its preview, none starts.
    const a = await screen.findByRole("link", { name: /^Session A · Push/ });
    expect(a.getAttribute("href")).toBe("/workouts/session/A");
    expect(a.textContent).toContain("6 exercises · about 55 min");
    expect(screen.getAllByRole("link", { name: /^Session [ABC] · / })).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /^(Start|See the session|Resume)$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^(See|Hide)$/ })).toBeNull();
    expect(screen.getByText("The program is edited on a computer.")).toBeTruthy();
  });

  it("says it in French", async () => {
    await i18n.changeLanguage("fr");
    renderRoute("/workouts?tab=program");
    expect(
      await screen.findByRole("link", { name: /^Séance C · Fessiers \+ tirage léger/ }),
    ).toBeTruthy();
    expect(screen.getByText("Le programme se modifie sur ordinateur.")).toBeTruthy();
  });
});
