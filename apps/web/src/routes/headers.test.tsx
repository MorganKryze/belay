import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { cleanup, screen, within } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
  writeLastUser(ADA);
  fakeApi({ me: ADA });
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

const WORKOUT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01";
const startedAt = new Date(2026, 9, 5, 18, 0).toISOString();
const endedAt = new Date(2026, 9, 5, 19, 0).toISOString();
const FINISHED: Change[] = [
  {
    kind: "workout",
    id: WORKOUT,
    field: "start",
    sessionCode: "B",
    plan: [...sessionByCode("B", starterProgram)!.slots],
    startedAt,
    at: startedAt,
  },
  { kind: "workout", id: WORKOUT, field: "ended", value: endedAt, at: endedAt },
];

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/);

// The large title, its compact copy in the bar, and a back chevron to `back` named `label`.
async function pushed(path: string, title: string, label: string, back: string) {
  renderRoute(path);
  const h1 = await screen.findByRole("heading", { level: 1, name: title });
  expect(classes(h1)).toContain("text-title-lg");
  expect(document.querySelector("[data-compact-title]")?.textContent).toBe(title);
  const link = within(screen.getByRole("main")).getByRole("link", { name: label });
  expect(link.getAttribute("href")).toBe(back);
  expect(classes(link.querySelector("svg"))).toContain("size-6");
  expect(link.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  return h1;
}
const fresh = () => {
  cleanup();
  indexedDB = new IDBFactory();
};

describe("pushed pages", () => {
  it("a session detail, an exercise, a tool, the equipment page, Profil and Compléments show their back chevron and large title", async () => {
    await seed(ADA.id, FINISHED);
    await pushed(`/workouts/${WORKOUT}`, "Session B · Legs", "History", "/workouts?tab=history");
    fresh();
    await pushed(
      "/exercises/ds:0025",
      "Barbell bench press",
      i18n.t("library.back"),
      "/workouts?tab=exercises",
    );
    fresh();
    await pushed("/tools/plates", i18n.t("tools.items.plates.name"), "Tools", "/tools");
    fresh();
    await pushed(
      "/tools/plates/equipment",
      "My equipment",
      i18n.t("tools.items.plates.name"),
      "/tools/plates",
    );
    fresh();
    const profile = await pushed("/settings/profile", "Profile", "Settings", "/settings");
    expect(profile.hasAttribute("data-focus-fallback")).toBe(true);
    fresh();
    const supplements = await pushed(
      "/settings/supplements",
      i18n.t("supplementsPage.title"),
      "Settings",
      "/settings",
    );
    expect(supplements.hasAttribute("data-focus-fallback")).toBe(true);
  });

  it("Réglages goes back to Accueil", async () => {
    await pushed("/settings", "Settings", "Home", "/");
  });

  it("not-found keeps a large title", async () => {
    renderRoute("/nowhere");
    const h1 = await screen.findByRole("heading", {
      level: 1,
      name: i18n.t("fallback.notFoundTitle"),
    });
    expect(classes(h1)).toContain("text-title-lg");
  });
});

// The bar's three columns: the back side, the compact title, the action side.
const bar = () => document.querySelector("[data-compact-title]")!.parentElement!;

describe("the bar's action", () => {
  it("an action sits at the right end of the bar and the back link keeps its place", async () => {
    await seed(ADA.id, FINISHED);
    renderRoute(`/workouts/${WORKOUT}`);
    await screen.findByRole("heading", { level: 1, name: "Session B · Legs" });
    const [left, title, right] = [...bar().children];
    expect(title!.hasAttribute("data-compact-title")).toBe(true);
    // Each side shows its own content and holds an inert, invisible copy of the other.
    expect(within(left as HTMLElement).getByRole("link", { name: "History" })).toBeTruthy();
    expect(within(right as HTMLElement).getByRole("link", { name: "Edit" })).toBeTruthy();
    const ghosts = bar().querySelectorAll("[inert]");
    expect([...ghosts].map((g) => [g.parentElement === left, g.textContent])).toEqual([
      [true, "Edit"],
      [false, "History"],
    ]);
    for (const g of ghosts) {
      expect(classes(g)).toContain("invisible");
      expect(g.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("with no action the bar is unchanged", async () => {
    renderRoute("/tools/plates");
    await screen.findByRole("heading", { level: 1, name: i18n.t("tools.items.plates.name") });
    const [left, , right] = [...bar().children];
    expect(left!.outerHTML).toBe(
      `<div>${within(left as HTMLElement).getByRole("link", { name: "Tools" }).outerHTML}</div>`,
    );
    // The right column is only the inert copy of the back link.
    expect(right!.getAttribute("class")).toBe("invisible");
    expect(right!.hasAttribute("inert")).toBe(true);
    expect(right!.innerHTML).toBe(left!.innerHTML);
  });
});

describe("the eyebrow", () => {
  it("an eyebrow sits above the large title and the compact title stays the title", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 7, 30));
    renderRoute("/");
    const h1 = await screen.findByRole("heading", { level: 1, name: "Hello, Ada" });
    const eyebrow = screen.getByText("Wednesday, October 7");
    expect(eyebrow.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // It fades with the large title as the page scrolls under the bar.
    expect(classes(eyebrow)).toContain("fold-out");
    expect(document.querySelector("[data-compact-title]")?.textContent).toBe("Hello, Ada");
  });
});
