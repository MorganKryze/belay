import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("an exercise's sheet", () => {
  it("a used-in card opens that session's preview", async () => {
    await i18n.changeLanguage("fr");
    const router = renderRoute("/exercises/ds:0025");
    const used = await screen.findByRole("link", { name: /^Séance A · Push/ });
    expect(used.getAttribute("href")).toBe("/workouts/session/A");
    fireEvent.click(used);
    expect(await screen.findByRole("heading", { name: "Séance A · Push", level: 1 })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/workouts/session/A");
    // The preview's own back chevron, not the tab of the same name in the bar.
    await waitFor(() => {
      const back = screen
        .getAllByRole("link", { name: "Programme" })
        .find((a) => a.closest("nav") === null);
      expect(back?.getAttribute("href")).toBe("/workouts?tab=program");
    });
  });
});
