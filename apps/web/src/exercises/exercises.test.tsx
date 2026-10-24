import { EXERCISES } from "@belay/shared/exercises/catalog";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { renderRoute } from "../test/render-route";
import { muscleColors, shapesOf, thumbnailOf, thumbnailSvg, thumbnailUrl } from "./body-map";
import { BACK, FRONT } from "./body-paths";
import { filterExercises, matches, visibleRange } from "./exercises-panel";

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("the search", () => {
  it("ignores case, accents and the order of words", () => {
    expect(matches("Barbell bench press", "PRESS bench")).toBe(true);
    expect(matches("Sled 45° leg press", "sléd  45°")).toBe(true);
    expect(matches("Barbell bench press", "bench squat")).toBe(false);
    expect(matches("Anything", "  ")).toBe(true);
  });

  it("filters on the primary muscle and the equipment, together", () => {
    const chest = filterExercises(EXERCISES, { query: "", muscle: "chest", equipment: null });
    expect(chest).toHaveLength(158);
    expect(chest.every((e) => e.primary[0] === "chest")).toBe(true);
    expect(
      filterExercises(EXERCISES, { query: "bench", muscle: "chest", equipment: "barbell" }).map(
        (e) => e.id,
      ),
    ).toContain("ds:0025");
  });
});

describe("the body map", () => {
  it("draws the outlines the copied file holds: three on each side of the upper back", () => {
    const upperBack = BACK.find((p) => p.slug === "upper-back")!;
    expect([upperBack.left.length, upperBack.right.length]).toEqual([3, 3]);
    expect(FRONT.find((p) => p.slug === "deltoids")!.left).toHaveLength(1);
    expect([...FRONT, ...BACK].some((p) => p.slug === "hair")).toBe(false);
  });

  it("splits the latissimus out of the upper back, and the deltoid in its heads", () => {
    const back = shapesOf("back");
    const front = shapesOf("front");
    const count = (shapes: typeof back, muscle: string) =>
      shapes.filter((s) => s.muscle === muscle).length;
    expect(count(back, "lats")).toBe(2);
    expect(count(back, "upper_back")).toBe(4 + 2); // the rest of upper-back, and the trapezius
    expect(count(back, "rear_delts")).toBe(2);
    expect(count(back, "side_delts")).toBe(2);
    expect(count(front, "front_delts")).toBe(2);
    expect(count(front, "side_delts")).toBe(2);
    expect(front.filter((s) => s.clip).every((s) => s.muscle?.endsWith("_delts"))).toBe(true);
  });

  it("colours the primary muscles full and the secondary ones lighter", () => {
    expect(muscleColors(["chest"], ["triceps", "front_delts"])).toEqual({
      "--m-chest": "var(--muscle-primary)",
      "--m-triceps": "var(--muscle-secondary)",
      "--m-front_delts": "var(--muscle-secondary)",
    });
  });

  it("frames a thumbnail on the primary muscle, front or back", () => {
    expect(thumbnailOf("chest")).toEqual({ view: "front", viewBox: "144 230 440 440" });
    expect(thumbnailOf("lats")).toEqual({ view: "back", viewBox: "864 230 440 440" });
    expect(thumbnailOf("glutes")).toEqual({ view: "back", viewBox: "864 480 440 440" });
    expect(thumbnailOf("quads")).toEqual({ view: "front", viewBox: "144 680 440 440" });
  });
});

describe("the thumbnails", () => {
  const palette = { primary: "#111111", secondary: "#222222", rest: "#333333" };

  it("bakes the colours into the picture: the primary muscle's outlines in the primary colour", () => {
    const svg = thumbnailSvg("chest", ["triceps"], palette);
    expect(svg).not.toContain("var(");
    const chestPath = shapesOf("front").find((s) => s.muscle === "chest")!.d;
    expect(svg).toContain(`<path d="${chestPath}" fill="#111111"`);
    expect(svg).toContain('fill="#222222"');
    expect(svg).toContain('fill="#333333"');
  });

  it("draws one picture per figure and theme, from the same URL each time", () => {
    // jsdom loads no stylesheet: give the muscles their tokens, as the light theme does.
    const root = document.documentElement;
    root.style.setProperty("--muscle-primary", palette.primary);
    root.style.setProperty("--muscle-secondary", palette.secondary);
    root.style.setProperty("--muscle-rest", palette.rest);
    try {
      const a = thumbnailUrl("chest", ["triceps", "abs"], false);
      expect(thumbnailUrl("chest", ["abs", "triceps"], false)).toBe(a);
      root.style.setProperty("--muscle-rest", "#010203"); // the dark theme's own colours
      expect(thumbnailUrl("chest", ["triceps", "abs"], true)).not.toBe(a);
      root.style.setProperty("--muscle-rest", palette.rest);
      expect(thumbnailUrl("chest", ["triceps"], false)).not.toBe(a);
      expect(thumbnailUrl("biceps", ["triceps", "abs"], false)).not.toBe(a);
    } finally {
      for (const name of ["--muscle-primary", "--muscle-secondary", "--muscle-rest"])
        root.style.removeProperty(name);
    }
  });

  it("reads the colours of the theme in force", () => {
    const root = document.documentElement;
    root.style.setProperty("--muscle-primary", "#abcdef");
    try {
      expect(decodeURIComponent(thumbnailUrl("lats", ["abs"], false))).toContain("#abcdef");
    } finally {
      root.style.removeProperty("--muscle-primary");
    }
  });
});

describe("the visible rows", () => {
  it("keeps a handful when the list starts far below the screen", () => {
    expect(visibleRange(1800, 840, 1290)).toEqual({ start: 0, end: 8 });
  });

  it("follows the screen down the list", () => {
    const { start, end } = visibleRange(-7200, 840, 1290);
    expect(start).toBe(100 - 8);
    expect(end).toBe(100 + 12 + 8);
    expect(visibleRange(-100000, 840, 1290)).toEqual({ start: 1290, end: 1290 });
  });
});

describe("the Exercises segment", () => {
  const openLibrary = async () => {
    renderRoute("/workouts?tab=exercises");
    return screen.findByRole("heading", { name: "In your program" });
  };

  it("puts the program's exercises first with their sessions, then all of them", async () => {
    await openLibrary();
    const program = within(screen.getByRole("main")).getAllByRole("list")[0]!;
    const first = within(program).getAllByRole("link")[0]!;
    expect(first.textContent).toContain("Barbell bench press");
    expect(first.textContent).toContain("Chest · Barbell");
    expect(first.textContent).toContain("A");
    const lateral = within(program).getByRole("link", { name: /Dumbbell lateral raise/ });
    expect(lateral.textContent).toContain("A · C");
    expect(screen.getByRole("heading", { name: "All · 1,291" })).toBeTruthy();
  });

  it("renders only the rows on screen of the 1 291", async () => {
    await openLibrary();
    const all = within(screen.getByRole("main")).getAllByRole("list")[1]!;
    const rows = within(all).getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(5);
    expect(rows.length).toBeLessThan(50);
    expect(rows[0]!.getAttribute("aria-setsize")).toBe("1291");
  });

  it("only the first row of a list draws no hairline", async () => {
    await openLibrary();
    for (const list of within(screen.getByRole("main")).getAllByRole("list").slice(0, 2)) {
      const lines = within(list)
        .getAllByRole("link")
        .slice(0, 3)
        .map((a) => a.classList.contains("border-t"));
      expect(lines).toEqual([false, true, true]);
    }
  });

  it("finds an exercise by words in any order", async () => {
    await openLibrary();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), {
      target: { value: "press bench barbell close" },
    });
    expect((await within(screen.getByRole("main")).findByRole("status")).textContent).toBe(
      "3 exercises",
    );
    expect(screen.getByRole("link", { name: /Barbell close-grip bench press/ })).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect((await within(screen.getByRole("main")).findByRole("status")).textContent).toBe(
      "No exercise matches.",
    );
    // No empty card under the line.
    expect(within(screen.getByRole("main")).queryByRole("list")).toBeNull();
  });

  it("filters by one muscle from a sheet that says how many will show, then clears it", async () => {
    await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Muscle" }));
    const sheet = await screen.findByRole("dialog", { name: "Muscle" });
    expect(within(sheet).getByText("Upper body")).toBeTruthy();
    expect(within(sheet).getAllByRole("radio")).toHaveLength(17); // all, then the 16
    fireEvent.click(within(sheet).getByRole("radio", { name: "Chest" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Show 158 exercises" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(within(screen.getByRole("main")).getByRole("status").textContent).toBe("158 exercises");
    expect(screen.getByRole("button", { name: "Muscle: Chest" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove the Chest filter" }));
    expect(await screen.findByRole("heading", { name: "In your program" })).toBeTruthy();
  });

  it("filters by equipment", async () => {
    await openLibrary();
    fireEvent.click(screen.getByRole("button", { name: "Equipment" }));
    const sheet = await screen.findByRole("dialog", { name: "Equipment" });
    expect(within(sheet).getAllByRole("radio")).toHaveLength(7);
    fireEvent.click(within(sheet).getByRole("radio", { name: "Cable" }));
    fireEvent.click(within(sheet).getByRole("button", { name: /^Show \d+ exercises$/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Equipment: Cable" })).toBeTruthy();
  });
});

describe("an exercise's sheet", () => {
  it("shows its equipment, body map, program use and steps", async () => {
    renderRoute("/exercises/ds:0025");
    expect(
      await screen.findByRole("heading", { name: "Barbell bench press", level: 1 }),
    ).toBeTruthy();
    expect(screen.getByText("Barbell · steps of 2.5 kg")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Body map: primary Chest; secondary Triceps, Front delts" }),
    ).toBeTruthy();
    const use = screen.getByRole("link", { name: /Session A · Push/ });
    expect(use.textContent).toContain("4 × 6–8 · RIR 1–2 · 2 min 30 s");
    const how = screen.getByRole("region", { name: "How to do it" });
    const steps = await within(how).findAllByRole("listitem");
    expect(steps[0]!.textContent).toBe(
      "Lie flat on a bench with your feet flat on the ground and your back pressed against the bench.",
    );
    expect(screen.getByText("Text: exercises-dataset (MIT)")).toBeTruthy();
  });

  it("says it in French, with each session that uses it", async () => {
    await i18n.changeLanguage("fr");
    renderRoute("/exercises/ds:0334");
    expect(await screen.findByRole("heading", { name: "Dumbbell lateral raise" })).toBeTruthy();
    expect(screen.getByText("Haltères · incrément 2 kg")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Silhouette : principal Épaules côté" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Séance A · Push/ }).textContent).toContain("tri-set");
    expect(
      screen.getByRole("link", { name: /Séance C · Fessiers \+ tirage léger/ }).textContent,
    ).toContain("1 min");
    expect(await screen.findByRole("heading", { name: "Comment faire" })).toBeTruthy();
    const how = screen.getByRole("region", { name: "Comment faire" });
    expect((await within(how).findAllByRole("listitem"))[0]!.textContent).toMatch(/^Tiens-toi/);
  });

  it("is not found for an id the library lacks", async () => {
    renderRoute("/exercises/ds:9999");
    expect(await screen.findByRole("heading", { name: "Page not found" })).toBeTruthy();
  });
});
