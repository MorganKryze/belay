import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { cleanup, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { expectTokensOnly } from "../test/design-rules";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";
import { tabIndexOf } from "./tab-bar";

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
const dock = async () => within(await screen.findByRole("navigation", { name: "Main" }));
const pill = () => document.querySelector("[data-dock] [data-pill]");

const WORKOUT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01";
const startedAt = new Date(2026, 9, 5, 18, 0).toISOString();
const endedAt = new Date(2026, 9, 5, 19, 0).toISOString();
const FINISHED: Change[] = [
  {
    kind: "workout",
    id: WORKOUT,
    field: "start",
    sessionCode: "B",
    plan: [...sessionByCode("B")!.slots],
    startedAt,
    at: startedAt,
  },
  { kind: "workout", id: WORKOUT, field: "ended", value: endedAt, at: endedAt },
];

describe("tabIndexOf", () => {
  it.each([
    ["/", 0],
    ["/workouts", 1],
    ["/workouts/abc", 1],
    ["/exercises/ds:0025", 1],
    ["/body", 2],
    ["/tools", 3],
    ["/tools/bmi", 3],
    ["/tools/plates/equipment", 3],
    ["/workout", null],
    ["/workout/summary/abc", null],
    ["/settings", null],
    ["/settings/profile", null],
    ["/bodyweight", null],
    ["/nowhere", null],
  ] as const)("%s is tab %s", (path, index) => {
    expect(tabIndexOf(path)).toBe(index);
  });
});

describe("the tab bar", () => {
  it("shows four tabs and no Réglages tab", async () => {
    fakeApi({ me: null });
    renderRoute("/tools");
    const nav = await dock();
    expect(nav.getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Home",
      "Sessions",
      "Body",
      "Tools",
    ]);
    expect(nav.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("marks the active tab with aria-current, the pill and a 700 label", async () => {
    fakeApi({ me: null });
    renderRoute("/body");
    const nav = await dock();
    const body = nav.getByRole("link", { name: "Body" });
    expect(body.getAttribute("aria-current")).toBe("page");
    expect(classes(body)).toContain("font-bold");
    expect(classes(body)).toContain("text-primary-ink");
    for (const name of ["Home", "Sessions", "Tools"]) {
      const link = nav.getByRole("link", { name });
      expect(link.getAttribute("aria-current"), name).toBeNull();
      expect(classes(link), name).not.toContain("font-bold");
    }
    const p = pill();
    expect(classes(p)).toEqual(
      expect.arrayContaining(["bg-tab-pill", "ring-[1.5px]", "ring-inset", "ring-primary-ink"]),
    );
    for (const svg of nav.getAllByRole("link").map((a) => a.querySelector("svg"))) {
      expect(classes(svg)).toContain("size-6");
    }
    expect(classes(body)).toContain("text-tab");
  });

  it("keeps Séances active on an exercise page and a session detail, Outils on every tool page", async () => {
    writeLastUser(ADA);
    fakeApi({ me: ADA });
    await seed(ADA.id, FINISHED);
    const current = async () =>
      (await dock())
        .getAllByRole("link")
        .filter((a) => a.getAttribute("aria-current") === "page")
        .map((a) => a.textContent);
    for (const [path, tab] of [
      ["/exercises/ds:0025", "Sessions"],
      [`/workouts/${WORKOUT}`, "Sessions"],
      ["/tools/bmi", "Tools"],
      ["/tools/plates", "Tools"],
      ["/tools/plates/equipment", "Tools"],
      ["/", "Home"],
    ] as const) {
      renderRoute(path);
      expect(await current(), path).toEqual([tab]);
      cleanup();
    }
  });

  it("slides one pill to the active tab's index", async () => {
    fakeApi({ me: null });
    for (const [path, index] of [
      ["/", "0"],
      ["/workouts", "1"],
      ["/body", "2"],
      ["/tools/bmi", "3"],
    ] as const) {
      renderRoute(path);
      await dock();
      expect(document.querySelectorAll("[data-dock] [data-pill]")).toHaveLength(1);
      const nav = document.querySelector<HTMLElement>("[data-dock] nav")!;
      expect(nav.style.getPropertyValue("--tab-i"), path).toBe(index);
      expect(classes(pill())).toEqual(
        expect.arrayContaining([
          "translate-x-[calc(var(--tab-i)*100%)]",
          "transition-transform",
          "duration-(--slide-duration)",
          "ease-nav",
        ]),
      );
      cleanup();
    }
  });

  it("shows no pill where no tab is current", async () => {
    fakeApi({ me: null });
    renderRoute("/nowhere");
    await dock();
    expect(pill()).toBeNull();
  });

  it("the bar is frosted, with an opaque fallback", async () => {
    fakeApi({ me: null });
    renderRoute("/");
    const nav = (await screen.findByRole("navigation", { name: "Main" })) as HTMLElement;
    expect(classes(nav)).toEqual(
      expect.arrayContaining(["glass", "shadow-float", "rounded-bar", "border", "border-border"]),
    );
    expect(nav.closest("[data-dock]")).not.toBeNull();
    const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");
    expect(css).toMatch(
      /@utility glass \{[^}]*@supports not \(backdrop-filter: blur\(1px\)\) \{\s*background-color: var\(--glass-fallback\)/,
    );
  });

  it("fades out under an open dialog, quicker and without motion when reduced", () => {
    const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");
    expect(css).toMatch(
      /html:has\(\[role="dialog"\]\[data-state="open"\]\) \[data-dock\] \{\s*opacity: 0;/,
    );
    expect(css).toMatch(
      /\[data-dock\] \{\s*transition: opacity var\(--fade-duration\) var\(--ease-out\);/,
    );
    expect(css).toMatch(/:root \{[^}]*--fade-duration: var\(--dur-fast\);/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{[^}]*--fade-duration: var\(--dur-reduced\);/,
    );
  });

  it("uses tokens only", () => {
    expectTokensOnly("components/tab-bar.tsx");
    expectTokensOnly("components/avatar.tsx");
  });
});
