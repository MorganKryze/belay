import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const avatar = () => within(screen.getByRole("main")).getByRole("link", { name: "Settings" });
const shell = () => screen.getByRole("main").parentElement!;

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
});
