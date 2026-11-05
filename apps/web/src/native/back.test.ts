import { afterEach, describe, expect, it, vi } from "vitest";
import { type BackRouter, installBack, stepBack, topOfStack } from "./back";

// A router at `href`, with or without an entry before it in this visit.
function routerAt(href: string, { canGoBack = false } = {}) {
  const url = new URL(href, "https://belay.test");
  return {
    state: {
      location: { pathname: url.pathname, search: Object.fromEntries(url.searchParams) },
    },
    history: { canGoBack: vi.fn(() => canGoBack), back: vi.fn() },
    navigate: vi.fn(),
  } satisfies BackRouter;
}

// A surface as Radix leaves it in the page: a role and its open or closing state.
function surface(role: string, state: "open" | "closed" = "open") {
  const el = document.createElement("div");
  el.setAttribute("role", role);
  el.setAttribute("data-state", state);
  document.body.append(el);
  return el;
}

afterEach(() => {
  document.body.replaceChildren();
  delete window.belayBack;
});

describe("what sits on top", () => {
  it("names Accueil's root, another tab's root, a pushed page and the session cover", () => {
    expect(topOfStack("/")).toBe("home");
    expect(topOfStack("/tools")).toBe("tab-root");
    expect(topOfStack("/workouts/")).toBe("tab-root");
    expect(topOfStack("/settings/profile")).toBe("page");
    expect(topOfStack("/workout")).toBe("cover");
  });

  it.each(["dialog", "alertdialog", "menu", "listbox"])(
    "an open %s wins over the page under it",
    (role) => {
      surface(role);
      for (const path of ["/", "/tools", "/settings/profile", "/workout"])
        expect(topOfStack(path)).toBe("surface");
    },
  );

  it("a sheet still leaving is a surface too", () => {
    surface("dialog", "closed");
    expect(topOfStack("/")).toBe("surface");
  });

  it("a list that is part of the page, with no open or closed state, is not a surface", () => {
    document.body.append(Object.assign(document.createElement("ul"), { role: "listbox" }));
    expect(topOfStack("/")).toBe("home");
  });
});

describe("one step back", () => {
  it("closes the top surface with one Escape, and nothing else moves", () => {
    surface("dialog");
    const keys: string[] = [];
    document.addEventListener("keydown", (e) => keys.push(e.key), { once: true });
    const router = routerAt("/settings/profile", { canGoBack: true });
    expect(stepBack(router)).toBe("surface");
    expect(keys).toEqual(["Escape"]);
    expect(router.history.back).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("a sheet still leaving swallows the press", () => {
    surface("dialog", "closed");
    const keys: string[] = [];
    const listen = (e: KeyboardEvent) => keys.push(e.key);
    document.addEventListener("keydown", listen);
    const router = routerAt("/settings/profile", { canGoBack: true });
    expect(stepBack(router)).toBe("surface");
    document.removeEventListener("keydown", listen);
    expect(keys).toEqual([]);
    expect(router.history.back).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("lowers the session cover by its own control", () => {
    const lower = document.createElement("button");
    lower.setAttribute("data-cover-lower", "");
    const click = vi.fn();
    lower.addEventListener("click", click);
    document.body.append(lower);
    const router = routerAt("/workout", { canGoBack: true });
    expect(stepBack(router)).toBe("cover");
    expect(click).toHaveBeenCalledOnce();
    expect(router.history.back).not.toHaveBeenCalled();
  });

  it("a cover with no lower control goes back as a page does", () => {
    const router = routerAt("/workout/edit", { canGoBack: true });
    expect(stepBack(router)).toBe("page");
    expect(router.history.back).toHaveBeenCalledOnce();
  });

  it("a pushed page shows the one before it", () => {
    const router = routerAt("/settings/profile", { canGoBack: true });
    expect(stepBack(router)).toBe("page");
    expect(router.history.back).toHaveBeenCalledOnce();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("a pushed page with nothing before it shows its tab's root in its place", () => {
    const router = routerAt("/tools/plates");
    expect(stepBack(router)).toBe("page");
    expect(router.history.back).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith({ to: "/tools", replace: true });
  });

  it("a page in no tab, or a preview opened from Accueil, falls back to Accueil", () => {
    for (const href of ["/settings/profile", "/workouts/session/a?from=home"]) {
      const router = routerAt(href);
      expect(stepBack(router)).toBe("page");
      expect(router.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    }
  });

  it("another tab's root shows Accueil in its place", () => {
    const router = routerAt("/body", { canGoBack: true });
    expect(stepBack(router)).toBe("tab-root");
    expect(router.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
    expect(router.history.back).not.toHaveBeenCalled();
  });

  it("Accueil's root does nothing and says so", () => {
    const router = routerAt("/", { canGoBack: true });
    expect(stepBack(router)).toBe("home");
    expect(router.history.back).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("is what the app's Back calls once installed", () => {
    const router = routerAt("/tools");
    installBack(router);
    expect(window.belayBack?.()).toBe("tab-root");
    expect(router.navigate).toHaveBeenCalledOnce();
  });
});
