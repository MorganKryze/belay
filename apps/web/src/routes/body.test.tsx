import { cleanup, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("the Body tab", () => {
  it("sits second in the bar: Home, Body, Tools, Settings", async () => {
    fakeApi({ me: null });
    renderRoute("/body");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Home", "Body", "Tools", "Settings"]);
    expect(within(nav).getByRole("link", { name: "Body" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("explains, signed out, that tracking needs an account", async () => {
    fakeApi({ me: null });
    renderRoute("/body");
    expect(await screen.findByText(/Tracking your weigh-ins needs an account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/auth/login?returnTo=%2Fbody",
    );
  });

  it("shows the sync banner to someone signed in", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/body");
    expect(await screen.findByText(/1 weigh-in waiting/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Body", level: 1 })).toBeTruthy();
  });
});
