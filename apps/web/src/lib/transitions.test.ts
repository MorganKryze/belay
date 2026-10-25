import { afterEach, describe, expect, it, vi } from "vitest";
import { routeTree } from "@/router";
import { levelOf, navKind, viewTransition } from "./transitions";

// One row per route of the router, with a concrete path for each parameter.
const LEVELS = [
  ["/", "/", 0],
  ["/workouts", "/workouts", 0],
  ["/body", "/body", 0],
  ["/tools", "/tools", 0],
  ["/settings", "/settings", 1],
  ["/workouts/$workoutId", "/workouts/0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01", 1],
  ["/workouts/session/$code", "/workouts/session/A", 1],
  ["/workouts/program", "/workouts/program", 1],
  ["/exercises/$exerciseId", "/exercises/ds:0025", 1],
  ["/tools/$toolId", "/tools/plates", 1],
  ["/settings/profile", "/settings/profile", 2],
  ["/settings/supplements", "/settings/supplements", 2],
  ["/tools/plates/equipment", "/tools/plates/equipment", 2],
  ["/workout", "/workout", "cover"],
  ["/workout/edit", "/workout/edit", "cover"],
  ["/workout/summary/$workoutId", "/workout/summary/0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01", "cover"],
] as const;

describe("levelOf", () => {
  it("has a row for every route of the router", () => {
    const paths: string[] = (routeTree.children ?? []).map((r) => r.fullPath);
    expect([...paths].sort()).toEqual(LEVELS.map(([route]) => route).sort());
  });

  it.each(LEVELS)("%s is at level %s", (_route, path, level) => {
    expect(levelOf(path)).toBe(level);
  });

  it("puts an unknown path at level 1", () => {
    expect(levelOf("/nowhere")).toBe(1);
    expect(levelOf("/workouts/a/b")).toBe(1);
  });

  it("reads a trailing slash as the same page", () => {
    expect(levelOf("/tools/")).toBe(0);
    expect(levelOf("/workout/")).toBe("cover");
  });
});

describe("navKind", () => {
  it("deeper is a push", () => {
    expect(navKind("/", "/settings", false)).toBe("push");
    expect(navKind("/workouts", "/exercises/ds:0025", false)).toBe("push");
    expect(navKind("/tools/plates", "/tools/plates/equipment", false)).toBe("push");
    expect(navKind("/", "/settings/profile", false)).toBe("push");
  });

  it("shallower is a pop", () => {
    expect(navKind("/settings", "/", false)).toBe("pop");
    expect(navKind("/settings/supplements", "/settings", false)).toBe("pop");
    expect(navKind("/tools/plates/equipment", "/tools", false)).toBe("pop");
  });

  it("tab to tab and tool to tool are instant", () => {
    expect(navKind("/", "/workouts", false)).toBe(false);
    expect(navKind("/body", "/tools", false)).toBe(false);
    expect(navKind("/tools/plates", "/tools/bmi", false)).toBe(false);
  });

  it("same path (search only) is instant", () => {
    expect(navKind("/workouts", "/workouts", false)).toBe(false);
  });

  it("the first load is instant", () => {
    expect(navKind(undefined, "/settings", false)).toBe(false);
  });

  it("into the session is a cover, out of it an uncover, its summary a cover over it", () => {
    expect(navKind("/", "/workout", false)).toBe("cover");
    expect(navKind("/workouts/x", "/workout/edit", false)).toBe("cover");
    expect(navKind("/workout", "/", false)).toBe("uncover");
    expect(navKind("/workout/summary/x", "/workouts", false)).toBe("uncover");
    expect(navKind("/workout", "/workout/summary/x", false)).toBe("cover");
    expect(navKind("/workout/summary/x", "/workout", false)).toBe(false);
    expect(navKind("/workout/edit", "/workout", false)).toBe(false);
  });

  it("a browser back swipe is instant", () => {
    expect(navKind("/settings", "/", true)).toBe(false);
    expect(navKind("/workout", "/", true)).toBe(false);
  });
});

describe("viewTransition", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const load = async (supported: boolean) => {
    vi.resetModules();
    vi.stubGlobal("CSS", { supports: () => supported });
    return (await import("./transitions")).viewTransition;
  };
  const change = (from: string, to: string) => ({
    fromLocation: { pathname: from },
    toLocation: { pathname: to },
    pathChanged: from !== to,
  });

  it("without typed transitions the router gets false", async () => {
    // jsdom has no CSS object at all.
    expect(viewTransition).toBe(false);
    expect(await load(false)).toBe(false);
  });

  it("with typed transitions it names the kind of each navigation", async () => {
    const vt = await load(true);
    expect(vt && vt.types(change("/", "/settings"))).toEqual(["push"]);
    expect(vt && vt.types(change("/settings", "/"))).toEqual(["pop"]);
    expect(vt && vt.types(change("/", "/workouts"))).toBe(false);
    expect(vt && vt.types({ toLocation: { pathname: "/" }, pathChanged: true })).toBe(false);
  });

  it("a back the browser already animates plays no second animation, and only that one", async () => {
    const vt = await load(true);
    const swipe = new PopStateEvent("popstate");
    Object.defineProperty(swipe, "hasUAVisualTransition", { value: true });
    window.dispatchEvent(swipe);
    expect(vt && vt.types(change("/settings", "/"))).toBe(false);
    expect(vt && vt.types(change("/", "/settings"))).toEqual(["push"]);
    // A plain Back (a button, a key) still slides.
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(vt && vt.types(change("/settings", "/"))).toEqual(["pop"]);
  });
});
