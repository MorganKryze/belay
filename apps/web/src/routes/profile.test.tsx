import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb, readOutbox, readProfile, readTarget, recordChanges } from "../sync/db";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA } from "../test/seed";

vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, recordChanges: vi.fn(real.recordChanges) };
});

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

  it("says so when the phone refuses the write, and clears it on the next one", async () => {
    await openProfile();
    vi.mocked(recordChanges).mockRejectedValueOnce(new DOMException("lost", "InvalidStateError"));
    fireEvent.click(button("Increase At least"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn't save on this phone. Try again.",
    );
    expect(await target()).toEqual({ minPct: 0.5, maxPct: 1 });
    fireEvent.click(button("Increase At least"));
    await waitFor(async () => expect(await target()).toEqual({ minPct: 0.55, maxPct: 1 }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
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

describe("Settings › Profile, your body", () => {
  const profile = async () => readProfile(await openAccountDb(ADA.id));

  it("fills in each fact, says which tools use it, and clears one", async () => {
    await openProfile();
    expect(
      screen.getByText(
        "Everything is optional. Each piece of information only serves the tools listed under it.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Used by: Energy expenditure, Body fat")).toBeTruthy();
    expect(screen.getByText("Used by: BMI, Body fat, Energy expenditure")).toBeTruthy();
    fireEvent.click(button("Fill in Formula"));
    fireEvent.click(await screen.findByRole("radio", { name: "Male" }));
    await waitFor(async () => expect((await profile()).formula).toBe("male"));
    fireEvent.click(button("Fill in Height"));
    fireEvent.change(await screen.findByRole("textbox", { name: "Height" }), {
      target: { value: "178" },
    });
    await waitFor(async () => expect((await profile()).heightCm).toBe(178));
    fireEvent.click(await screen.findByRole("button", { name: "Clear Formula" }));
    await waitFor(async () => expect((await profile()).formula).toBeNull());
    expect(await screen.findByRole("button", { name: "Fill in Formula" })).toBeTruthy();
    const queued = (await readOutbox(await openAccountDb(ADA.id))).map((e) => e.change);
    expect(queued.map((c) => (c.kind === "profile" ? [c.field, c.value] : null))).toEqual([
      ["formula", "male"],
      ["height", 178],
      ["formula", null],
    ]);
  });

  it("takes a year of birth for ages 15 to 100 only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 9));
    try {
      await openProfile();
      fireEvent.click(button("Fill in Year of birth"));
      const year = await screen.findByRole("textbox", { name: "Year of birth" });
      fireEvent.change(year, { target: { value: "1925" } }); // 101 this year
      fireEvent.change(year, { target: { value: "2012" } }); // 14 this year
      fireEvent.change(year, { target: { value: "1995" } });
      await waitFor(async () => expect((await profile()).birthYear).toBe(1995));
      const queued = (await readOutbox(await openAccountDb(ADA.id))).map((e) => e.change);
      expect(queued).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what each fact serves in French", async () => {
    await i18n.changeLanguage("fr");
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/settings/profile");
    // Testing Library folds every space, the narrow no-break one included, into a plain one.
    expect(await screen.findByText("Sert à : Dépense énergétique, Masse grasse")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Renseigner Année de naissance" })).toBeTruthy();
  });

  it("leads to the supplements list, with how many are on it", async () => {
    await openProfile();
    const link = await screen.findByRole("link", { name: "My supplements 0" });
    expect(link.getAttribute("href")).toBe("/settings/supplements");
  });
});
