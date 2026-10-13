import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { expectTokensOnly } from "../test/design-rules";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA } from "../test/seed";
import { BackLink, PageHeader } from "./page-header";

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
const compact = () => document.querySelector("[data-compact-title]");

describe("PageHeader", () => {
  it("the large title is the page's h1 and the compact title is hidden from screen readers", () => {
    render(<PageHeader title="Sessions" />);
    const h1 = screen.getByRole("heading", { level: 1, name: "Sessions" });
    expect(classes(h1)).toContain("text-title-lg");
    expect(compact()?.textContent).toBe("Sessions");
    expect(compact()?.getAttribute("aria-hidden")).toBe("true");
    expect(classes(compact())).toContain("text-title-compact");
    expect(screen.getAllByText("Sessions")).toHaveLength(2);
  });

  it("a pushed page shows its back chevron above the title", async () => {
    const root = createRootRoute({ component: Outlet });
    const page = createRoute({
      getParentRoute: () => root,
      path: "/settings",
      component: () => <PageHeader title="Settings" back={<BackLink to="/">Home</BackLink>} />,
    });
    const home = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
    const router = createRouter({
      routeTree: root.addChildren([home, page]),
      history: createMemoryHistory({ initialEntries: ["/settings"] }),
    });
    render(<RouterProvider router={router} />);
    const back = await screen.findByRole("link", { name: "Home" });
    expect(back.getAttribute("href")).toBe("/");
    expect(classes(back)).toEqual(expect.arrayContaining(["min-h-11", "min-w-11", "text-primary"]));
    expect(classes(back.querySelector("svg"))).toContain("size-6");
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(back.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the trailing action on the right", () => {
    render(<PageHeader title="Sessions" trailing={<button type="button">Log</button>} />);
    const row = screen.getByRole("heading", { level: 1 }).parentElement!;
    expect(classes(row)).toEqual(expect.arrayContaining(["flex", "justify-between"]));
    expect(row.lastElementChild?.textContent).toBe("Log");
  });

  it("focusFallback marks the h1 for sheets", () => {
    render(<PageHeader title="Body" focusFallback />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.getAttribute("tabindex")).toBe("-1");
    expect(h1.hasAttribute("data-focus-fallback")).toBe(true);
    cleanup();
    render(<PageHeader title="Tools">Lead line</PageHeader>);
    expect(screen.getByRole("heading", { level: 1 }).hasAttribute("data-focus-fallback")).toBe(
      false,
    );
    expect(screen.getByText("Lead line")).toBeTruthy();
  });

  it("Home in every account state, Séances, Corps and Outils keep their titles in the shared header", async () => {
    const titled = async (path: string, name: string) => {
      renderRoute(path);
      const h1 = await screen.findByRole("heading", { level: 1, name });
      expect(classes(h1)).toContain("text-title-lg");
      expect(compact()?.textContent).toBe(name);
      cleanup();
      indexedDB = new IDBFactory();
    };
    fakeApi({ me: null });
    await titled("/", "Belay");
    await titled("/body", "Body");
    await titled("/workouts", "Sessions");
    await titled("/tools", "Tools");
    fakeApi({ me: ADA });
    await titled("/", "Hello, Ada");
    await titled("/body", "Body");
    writeLastUser(ADA);
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderRoute("/");
    const h1 = await screen.findByRole("heading", { level: 1, name: "Hello, Ada" });
    expect(classes(h1)).toContain("text-title-lg");
  });

  it("the header folds over the first 44 px of scroll, shows compact from the start without scroll timelines and under reduced motion", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");
    expect(css).toMatch(/animation-timeline:\s*scroll\(root\)/);
    // Ends at the bottom of a page that scrolls less than 44 px, so the fold never stops halfway.
    expect(css).toMatch(/animation-range:\s*0\s+min\(44px,\s*100%\)/);
    expect(css).toMatch(
      /@keyframes fold-in\s*\{\s*from\s*\{\s*opacity:\s*0;?\s*\}\s*to\s*\{\s*opacity:\s*1;?\s*\}\s*\}/,
    );
    // A page that does not scroll has no active timeline: the compact header rests hidden.
    expect(css).toMatch(/:root\s*\{[^}]*--fold-rest:\s*0;/);
    expect(css).toMatch(/opacity:\s*var\(--fold-rest\)/);
    expect(css).toMatch(/@keyframes fold-out\s*\{\s*to\s*\{\s*opacity:\s*0;?\s*\}\s*\}/);
    const fallback = css.match(/@supports not \(animation-timeline: scroll\(\)\)\s*\{([^}]*\}){2}/);
    expect(fallback?.[0]).toMatch(/animation:\s*none/);
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{[^}]*\}/);
    expect(reduced?.[0]).toMatch(/--fold-in:\s*none/);
    expect(reduced?.[0]).toMatch(/--fold-out:\s*none/);
    expect(reduced?.[0]).toMatch(/--fold-rest:\s*1/);
    expectTokensOnly("components/page-header.tsx");
  });
});
