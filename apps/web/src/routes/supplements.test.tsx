import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, readSupplements } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const stored = async () =>
  (await readSupplements(await openAccountDb(ADA.id))).map((s) => [s.name, s.kind, s.removed]);

async function openList() {
  writeLastUser(ADA);
  fakeApi({ me: "down" }); // the list works offline too
  renderRoute("/settings/supplements");
  return screen.findByRole("heading", { name: "My supplements", level: 1 });
}

describe("Settings › My supplements", () => {
  it("starts empty, adds a suggestion in one tap, and the suggestion leaves", async () => {
    await openList();
    expect(await screen.findByText("No supplements on your list yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Creatine" }));
    const marked = await screen.findByText("14 days marked");
    expect(within(marked.closest("li")!).getByText("Creatine")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Creatine" })).toBeNull();
    expect(screen.getByRole("button", { name: "Vitamin D" })).toBeTruthy();
    expect(await stored()).toEqual([["Creatine", "creatine", false]]);
  });

  it("adds a name typed by the person, trimmed, and refuses an empty or long one", async () => {
    await openList();
    const name = await screen.findByRole("textbox", { name: "Supplement name" });
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("Between 1 and 40 characters, on one line.")).toBeTruthy();
    fireEvent.change(name, { target: { value: "  Ashwagandha " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(async () => expect(await stored()).toEqual([["Ashwagandha", "other", false]]));
    await waitFor(() => expect((name as HTMLInputElement).value).toBe(""));
    expect((name as HTMLInputElement).maxLength).toBe(40);
  });

  it("renames one, and removes another with an undo", async () => {
    await openList();
    fireEvent.click(await screen.findByRole("button", { name: "Iron" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zinc" }));
    fireEvent.click(await screen.findByRole("button", { name: "More for Iron" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "New name for Iron" });
    fireEvent.change(field, { target: { value: "Iron bisglycinate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Iron bisglycinate")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More for Zinc" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "More for Zinc" })).toBeNull());
    expect(screen.getByRole("button", { name: "Zinc" })).toBeTruthy(); // back among suggestions
    expect(screen.getByText("Supplement removed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: "More for Zinc" })).toBeTruthy();
    const queued = (await readOutbox(await openAccountDb(ADA.id))).map((e) => e.change);
    expect(queued.map((c) => (c.kind === "supplement" ? [c.field, c.value] : null))).toEqual([
      ["name", "Iron"],
      ["name", "Zinc"],
      ["name", "Iron bisglycinate"],
      ["removed", true],
      ["removed", false],
    ]);
  });

  it("speaks French, with its suggestions", async () => {
    await i18n.changeLanguage("fr");
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/settings/supplements");
    expect(await screen.findByRole("heading", { name: "Mes compléments" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Oméga-3" })).toBeTruthy();
    expect(
      screen.getByText(
        "Belay note ce que tu prends, sans conseil de dose. Les rappels quotidiens arriveront avec les notifications.",
      ),
    ).toBeTruthy();
  });

  it("asks someone signed out to sign in", async () => {
    fakeApi({ me: null });
    renderRoute("/settings/supplements");
    expect((await screen.findByRole("link", { name: "Sign in" })).getAttribute("href")).toBe(
      "/auth/login?returnTo=%2Fsettings%2Fsupplements",
    );
  });
});

describe("Settings › My supplements, duplicates, double taps and focus", () => {
  it("refuses a name already on the list, accents and case aside", async () => {
    await openList();
    const name = await screen.findByRole("textbox", { name: "Supplement name" });
    fireEvent.change(name, { target: { value: "Cafeine" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(async () => expect(await stored()).toEqual([["Cafeine", "other", false]]));
    fireEvent.change(name, { target: { value: " CAFÉINE " } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByText("This supplement is already on your list.")).toBeTruthy();
    expect(await stored()).toHaveLength(1);
  });

  it("adds once on a double tap, and a chip leaves the typed name alone", async () => {
    await openList();
    const name = (await screen.findByRole("textbox", {
      name: "Supplement name",
    })) as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Draft" } });
    const chip = await screen.findByRole("button", { name: "Iron" });
    fireEvent.click(chip);
    fireEvent.click(chip);
    await screen.findByRole("button", { name: "More for Iron" });
    expect(await stored()).toEqual([["Iron", "other", false]]);
    expect(name.value).toBe("Draft");
  });

  it("refuses a rename to an empty name or to another supplement's, but not to its own", async () => {
    await openList();
    fireEvent.click(await screen.findByRole("button", { name: "Iron" }));
    fireEvent.click(await screen.findByRole("button", { name: "Zinc" }));
    fireEvent.click(await screen.findByRole("button", { name: "More for Iron" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "New name for Iron" });
    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Between 1 and 40 characters, on one line.")).toBeTruthy();
    expect(field.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(field, { target: { value: " zinc " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("This supplement is already on your list.")).toBeTruthy();
    expect(await stored()).toEqual([
      ["Iron", "other", false],
      ["Zinc", "other", false],
    ]);
    fireEvent.change(field, { target: { value: "IRON" } }); // its own name, other case
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () =>
      expect(await stored()).toEqual([
        ["IRON", "other", false],
        ["Zinc", "other", false],
      ]),
    );
  });

  it("returns the focus to the row's menu button after Save and Cancel, and to the title after Remove", async () => {
    await openList();
    fireEvent.click(await screen.findByRole("button", { name: "Iron" }));
    fireEvent.click(await screen.findByRole("button", { name: "More for Iron" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "More for Iron" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "More for Iron" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New name for Iron" }), {
      target: { value: "Iron+" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "More for Iron+" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "More for Iron+" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 })),
    );
  });
});
