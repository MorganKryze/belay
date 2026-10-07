import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, readTarget } from "../sync/db";
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

const target = async () => readTarget(await openAccountDb(ADA.id));
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

async function openProfile() {
  writeLastUser(ADA);
  fakeApi({ me: "down" }); // the profile works offline too
  renderRoute("/settings/profile");
  return screen.findByRole("textbox", { name: "At least" });
}

describe("Settings › Profile", () => {
  it("is reached from Settings, with a way back", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    renderRoute("/settings");
    const link = await screen.findByRole("link", { name: "Profile" });
    expect(link.getAttribute("href")).toBe("/settings/profile");
  });

  it("asks someone signed out to sign in", async () => {
    fakeApi({ me: null });
    renderRoute("/settings/profile");
    expect(await screen.findByText(/Tracking your weigh-ins needs an account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      "/auth/login?returnTo=%2Fsettings%2Fprofile",
    );
    const back = within(screen.getByRole("main")).getByRole("link", { name: "Settings" });
    expect(back.getAttribute("href")).toBe("/settings");
    expect(back.getAttribute("aria-current")).toBeNull(); // the way back, not the current page
  });

  it("starts at 0.5 to 1 %, and writes both bounds together when one moves", async () => {
    const atLeast = (await openProfile()) as HTMLInputElement;
    expect(atLeast.value).toBe("0.5");
    expect((screen.getByRole("textbox", { name: "At most" }) as HTMLInputElement).value).toBe("1");
    fireEvent.click(button("Increase At least"));
    await waitFor(async () => expect(await target()).toEqual({ minPct: 0.55, maxPct: 1 }));
    const [entry] = await readOutbox(await openAccountDb(ADA.id));
    expect(entry!.change).toMatchObject({ kind: "target", minPct: 0.55, maxPct: 1 });
  });

  it("stops at 1 % and keeps the lower bound 0.1 under the upper one", async () => {
    await openProfile();
    expect(button("Increase At most").getAttribute("aria-disabled")).toBe("true");
    const atLeast = screen.getByRole("textbox", { name: "At least" });
    fireEvent.change(atLeast, { target: { value: "0.95" } });
    fireEvent.blur(atLeast); // clamped to 0.9, the most the upper bound allows
    await waitFor(async () => expect(await target()).toEqual({ minPct: 0.9, maxPct: 1 }));
    await waitFor(() =>
      expect(button("Increase At least").getAttribute("aria-disabled")).toBe("true"),
    );
    expect(button("Decrease At most").getAttribute("aria-disabled")).toBe("true");
  });

  it("stops at 0.25 % and rounds a typed value to the 0.05 step", async () => {
    const atLeast = await openProfile();
    fireEvent.change(atLeast, { target: { value: "0,33" } });
    fireEvent.blur(atLeast);
    await waitFor(() => expect((atLeast as HTMLInputElement).value).toBe("0.35"));
    fireEvent.click(button("Decrease At least"));
    await waitFor(() => expect((atLeast as HTMLInputElement).value).toBe("0.3"));
    fireEvent.click(button("Decrease At least"));
    await waitFor(() => expect((atLeast as HTMLInputElement).value).toBe("0.25"));
    expect(button("Decrease At least").getAttribute("aria-disabled")).toBe("true");
    expect(await target()).toEqual({ minPct: 0.25, maxPct: 1 });
  });

  it("says how the range is chosen, with its sources", async () => {
    await openProfile();
    expect(screen.getByText("How it's chosen")).toBeTruthy();
    expect(screen.getByText("Scientific source")).toBeTruthy();
    expect(screen.getByText("Belay offers no more than 1% per week.")).toBeTruthy();
  });

  it("speaks French with the narrow spaces", async () => {
    await i18n.changeLanguage("fr");
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/settings/profile");
    expect(await screen.findByText("Comment c'est choisi")).toBeTruthy();
    expect(
      screen.getByText(
        "Réglable de 0,25 à 1 %. Les recommandations publiées s'arrêtent à 1 % : l'app ne propose pas plus.",
        { normalizer: (s) => s },
      ),
    ).toBeTruthy();
  });
});
