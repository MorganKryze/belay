import { cleanup, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { expectTokensOnly } from "../test/design-rules";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";

beforeEach(() => {
  indexedDB = new IDBFactory();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);
const bar = async () => within(await screen.findByRole("banner"));

describe("the top bar", () => {
  it("shows the mark at 28 px and Belay leading to Accueil", async () => {
    fakeApi({ me: null });
    renderRoute("/tools");
    const home = (await bar()).getByRole("link", { name: "Belay" });
    expect(home.getAttribute("href")).toBe("/");
    const mark = home.querySelector("svg")!;
    expect(classes(mark)).toEqual(expect.arrayContaining(["size-7", "text-primary"]));
    expect(mark.querySelector("path")!.getAttribute("fill")).toBe("currentColor");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
  });

  it("lists the four sections, the active one on primary-soft with a primary-ink edge and aria-current", async () => {
    fakeApi({ me: null });
    renderRoute("/tools/bmi");
    const nav = within((await bar()).getByRole("navigation"));
    const links = nav.getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Home", "Sessions", "Body", "Tools"]);
    const tools = nav.getByRole("link", { name: "Tools" });
    expect(tools.getAttribute("aria-current")).toBe("page");
    expect(classes(tools)).toEqual(
      expect.arrayContaining(["bg-primary-soft", "ring-[1.5px]", "ring-inset", "ring-primary-ink"]),
    );
    for (const link of links.filter((a) => a !== tools)) {
      expect(link.getAttribute("aria-current")).toBeNull();
      expect(classes(link)).not.toContain("bg-primary-soft");
    }
  });

  it("puts the avatar on the right, opening Réglages", async () => {
    fakeApi({ me: null });
    renderRoute("/body");
    const banner = await screen.findByRole("banner");
    const avatar = within(banner).getByRole("link", { name: "Settings" });
    expect(avatar.getAttribute("href")).toBe("/settings");
    expect(banner.querySelector(":scope > div > :last-child")).toBe(avatar);
  });

  it("every target is 44 px", async () => {
    fakeApi({ me: null });
    renderRoute("/");
    for (const link of (await bar()).getAllByRole("link")) {
      expect(
        classes(link).some((c) => ["min-h-11", "size-11"].includes(c)),
        link.textContent ?? "",
      ).toBe(true);
    }
  });

  it("is hidden below 1 024 px", async () => {
    fakeApi({ me: null });
    renderRoute("/");
    const banner = await screen.findByRole("banner");
    expect(classes(banner)).toEqual(
      expect.arrayContaining(["hidden", "lg:flex", "sticky", "top-0", "bg-surface"]),
    );
    expect(classes(banner)).not.toContain("glass");
  });

  it("uses tokens only", () => {
    expectTokensOnly("components/top-bar.tsx");
  });
});
