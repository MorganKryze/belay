import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import mainEn from "../i18n/en.json";
import mainFr from "../i18n/fr.json";
import lazyEn from "../i18n/lazy/en.json";
import lazyFr from "../i18n/lazy/fr.json";
import { Pending, PENDING_TITLES } from "./fallbacks";

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("en");
});

const read = (strings: object, key: string) =>
  key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], strings);

// The pending page alone, on a router standing at `path`.
async function renderPending(path: string, title?: boolean) {
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (title === undefined ? <Pending /> : <Pending title={title} />),
    }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return screen.findByRole("status");
}

describe("pending page", () => {
  it("the pending title uses the same words as each tab page's title, in French and English", () => {
    expect(PENDING_TITLES).toEqual({
      "/workouts": "nav.workouts",
      "/body": "nav.body",
      "/tools": "nav.tools",
    });
    for (const [main, lazy] of [
      [mainEn, lazyEn],
      [mainFr, lazyFr],
    ] as const) {
      for (const [path, key] of Object.entries(PENDING_TITLES)) {
        const page = `${path.slice(1)}.title`;
        // The page's title lives with its screen's strings, loaded on demand or not.
        expect(read(main, key), key).toBe(read(lazy, page) ?? read(main, page));
        expect(read(main, key), key).toBeTypeOf("string");
      }
    }
  });

  it("the pending page announces itself and hides its title and mark", async () => {
    const status = await renderPending("/body");
    expect(status.textContent).toBe("Loading…");
    const title = screen.getByText("Body");
    expect(title.closest("[aria-hidden]")).not.toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
    const mark = document.querySelector(".loader-mark")!;
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(
      [...mark.querySelectorAll("[data-hook]")].map((h) => h.getAttribute("data-hook")),
    ).toEqual(["a", "b"]);
    expect(document.querySelector("[data-pending]")).not.toBeNull();
  });

  it("speaks French with the French strings", async () => {
    await i18n.changeLanguage("fr");
    const status = await renderPending("/tools");
    expect(status.textContent).toBe("Chargement…");
    expect(screen.getByText("Outils")).toBeTruthy();
  });

  it("shows the mark alone on a page outside the tabs, or when asked for no title", async () => {
    await renderPending("/settings");
    expect(document.querySelector("[data-pending]")!.textContent).toBe("Loading…");
    cleanup();
    await renderPending("/body", false);
    expect(document.querySelector("[data-pending]")!.textContent).toBe("Loading…");
  });
});
