import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await i18n.changeLanguage("en");
});

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const avatar = () => within(screen.getByRole("main")).getByRole("link", { name: "Settings" });
const shell = () => screen.getByRole("main").parentElement!;
const sessionBar = () => screen.queryByRole("link", { name: /In progress/ });

// A session started a few minutes ago and still open.
const OPEN = (): Change[] => {
  const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  return [
    {
      kind: "workout",
      id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d02",
      field: "start",
      sessionCode: "C",
      plan: [...sessionByCode("C")!.slots],
      startedAt,
      at: startedAt,
    },
  ];
};

describe("the shell", () => {
  it("no tab bar on Réglages, Profil, Compléments and the session cover", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    for (const [path, title] of [
      ["/settings", "Settings"],
      ["/settings/profile", "Profile"],
      ["/settings/supplements", "My supplements"],
    ] as const) {
      renderRoute(path);
      await screen.findByRole("heading", { level: 1, name: title });
      expect(screen.queryByRole("navigation", { name: "Main" }), path).toBeNull();
      expect(document.querySelector("[data-dock]"), path).toBeNull();
      cleanup();
    }
    renderRoute("/workout?start=A");
    await screen.findByRole("heading", { level: 1, name: "Session A · Push" });
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("Accueil shows the avatar in every account state, named Réglages, and it opens Réglages", async () => {
    // Loading: the account question never gets an answer.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderRoute("/");
    await screen.findByRole("heading", { level: 1, name: "Belay" });
    expect(avatar().getAttribute("href")).toBe("/settings");
    cleanup();
    vi.unstubAllGlobals();

    fakeApi({ me: null });
    renderRoute("/");
    await screen.findByRole("link", { name: "Sign in" });
    expect(avatar().getAttribute("href")).toBe("/settings");
    cleanup();

    fakeApi({ me: "down" });
    renderRoute("/");
    await screen.findByText("Can't reach the server right now.");
    expect(avatar().getAttribute("href")).toBe("/settings");
    cleanup();

    writeLastUser(ADA);
    fakeApi({ me: ADA });
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderRoute("/");
    await screen.findByText(/won't let Belay save on the device/);
    expect(avatar().getAttribute("href")).toBe("/settings");
    cleanup();
    vi.restoreAllMocks();

    fakeApi({ me: ADA });
    renderRoute("/");
    await screen.findByRole("heading", { level: 1, name: "Hello, Ada" });
    const link = avatar();
    expect(classes(link)).toEqual(expect.arrayContaining(["size-11", "rounded-round"]));
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("the avatar shows the initial when a name is known, a person icon otherwise", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    renderRoute("/");
    await screen.findByRole("heading", { level: 1, name: "Hello, Ada" });
    const named = avatar();
    expect(named.textContent).toBe("A");
    expect(named.querySelector("[aria-hidden]")?.textContent).toBe("A");
    expect(named.querySelector("svg")).toBeNull();
    cleanup();
    localStorage.clear();

    fakeApi({ me: null });
    renderRoute("/");
    await screen.findByRole("link", { name: "Sign in" });
    const anonymous = avatar();
    expect(anonymous.textContent).toBe("");
    expect(anonymous.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the page is padded for the whole dock", async () => {
    fakeApi({ me: null });
    renderRoute("/tools");
    await screen.findByRole("heading", { level: 1, name: "Tools" });
    expect(classes(shell())).toEqual(
      expect.arrayContaining([
        "[--chrome-bottom:calc(4.5rem+max(0.75rem,env(safe-area-inset-bottom)))]",
        "pb-[calc(var(--chrome-bottom)+0.5rem)]",
      ]),
    );
    expect(classes(document.querySelector("[data-dock]"))).toContain(
      "bottom-[max(0.75rem,env(safe-area-inset-bottom))]",
    );
    cleanup();
    renderRoute("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(classes(shell())).toContain("pb-[max(1rem,env(safe-area-inset-bottom))]");
  });
  it("shows the bar on a phone outside the cover while a session is open, never on the cover or without one", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    renderRoute("/tools");
    await screen.findByRole("heading", { level: 1, name: "Tools" });
    await screen.findByRole("navigation", { name: "Main" });
    expect(sessionBar()).toBeNull();
    cleanup();

    await seed(ADA.id, OPEN());
    renderRoute("/tools");
    const bar = await screen.findByRole("link", { name: /In progress/ });
    expect(bar.getAttribute("href")).toBe("/workout?start=C");
    expect(bar.closest("[data-dock]")).toBeTruthy();
    expect(classes(bar)).toContain("lg:hidden");
    cleanup();

    renderRoute("/workout?start=C");
    await screen.findByRole("heading", { level: 1, name: /Session C/ });
    expect(sessionBar()).toBeNull();
    cleanup();

    renderRoute("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    expect(sessionBar()).toBeNull();
  });

  it("drops the bar once the session passes the forgotten mark, with no new data", async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    // Its last set 30 s short of the 6 hours after which the session counts as forgotten.
    const [start] = OPEN();
    const at = new Date(Date.now() - 6 * 3_600_000 + 30_000).toISOString();
    await seed(ADA.id, [
      { ...start!, startedAt: at, at } as Change,
      {
        kind: "set",
        id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d03",
        workoutId: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d02",
        field: "create",
        slotIndex: 0,
        position: 3,
        exerciseId: sessionByCode("C")!.slots[0]!.exerciseId,
        warmup: false,
        weightKg: 80,
        reps: 10,
        rir: 1,
        doneAt: at,
        at,
      },
    ]);
    renderRoute("/tools");
    await screen.findByRole("link", { name: /In progress/ });
    // A minute on, with no new data, and past its exit: tapping it now would start a new
    // session instead of reopening this one.
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(sessionBar()).toBeNull();
  });

  it("pads the page for the dock and the bar", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    await seed(ADA.id, OPEN());
    renderRoute("/tools");
    await screen.findByRole("link", { name: /In progress/ });
    expect(classes(shell())).toEqual(
      expect.arrayContaining([
        "[--chrome-bottom:calc(8.875rem+max(0.75rem,env(safe-area-inset-bottom)))]",
        "pb-[calc(var(--chrome-bottom)+0.5rem)]",
      ]),
    );
    expect(classes(document.querySelector("[data-dock]"))).toEqual(
      expect.arrayContaining([
        "bottom-0",
        "glass",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      ]),
    );
  });
});
