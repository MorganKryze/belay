import { expect, type Locator, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

// Wednesday 7 October 2026 in Paris, the day the fixture's weeks lead up to; timers still run.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T08:00:00+02:00"));
});

type Theme = "light" | "dark";
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

// Paper, surface and ink of each theme, and the blue kept for the screen's next action.
const BASE = {
  light: {
    background: "#f3f5f5",
    surface: "#ffffff",
    foreground: "#12181c",
    sunk: "#edf0f1",
    mark: "#1f4e8c",
  },
  dark: {
    background: "#10151a",
    surface: "#182027",
    foreground: "#eef2f3",
    sunk: "#1f2931",
    mark: "#8db6ee",
  },
} as const;

// The same slots when more contrast is asked for.
const MORE = {
  light: {
    background: "#f3f5f5",
    surface: "#ffffff",
    foreground: "#000000",
    "muted-foreground": "#343d43",
    border: "#8e9aa1",
    track: "#dde3e5",
    sunk: "#e4e9ea",
    "chart-day": "#5f686e",
    mark: "#143a6b",
    "on-mark": "#ffffff",
  },
  dark: {
    background: "#0a0e12",
    surface: "#182027",
    foreground: "#ffffff",
    "muted-foreground": "#cbd4d9",
    border: "#6f7d86",
    track: "#2e3a43",
    sunk: "#27323b",
    "chart-day": "#98a3aa",
    mark: "#b5d0f5",
    "on-mark": "#000000",
  },
} as const;

async function open(page: Page, theme: Theme, path: string, width = 390) {
  await page.setViewportSize({ width, height: 860 });
  await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page, { rows: WEEKS });
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
}

// Each token as the page paints it.
const tokens = (page: Page, names: string[]) =>
  page.evaluate((list) => {
    const probe = document.createElement("i");
    document.body.append(probe);
    const out = Object.fromEntries(
      list.map((name) => {
        probe.style.color = `var(--${name})`;
        return [name, getComputedStyle(probe).color];
      }),
    );
    probe.remove();
    return out;
  }, names);

const expectTokens = async (page: Page, slots: Record<string, string>) =>
  expect(await tokens(page, Object.keys(slots))).toEqual(
    Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, rgb(v)])),
  );

// Every colour an element and what it holds paint: text, fills, edges and SVG strokes, the
// transparent ones and the focus ring left out.
const paints = (el: Locator) =>
  el.evaluate((root) => {
    const seen = new Set<string>();
    for (const node of [root, ...root.querySelectorAll("*")]) {
      const s = getComputedStyle(node);
      const edges = (["Top", "Right", "Bottom", "Left"] as const)
        .filter((side) => parseFloat(s[`border${side}Width`]) > 0)
        .map((side) => s[`border${side}Color`]);
      for (const c of [s.color, s.backgroundColor, s.fill, s.stroke, ...edges])
        if (/^rgba?\(/.test(c) && !/,\s*0\)$/.test(c)) seen.add(c);
    }
    return [...seen];
  });

// Ink and the cool greys hold their three channels within a few steps of each other, leaning
// to blue if at all; the old orange and the warm neutrals lean red, a green leans green, and the
// blue spreads far wider.
const neutral = (color: string) => {
  const [r, g, b] = color.match(/\d+(\.\d+)?/g)!.map(Number) as [number, number, number];
  return Math.max(r, g, b) - Math.min(r, g, b) <= 24 && r <= g + 2 && g <= b + 2;
};

async function expectInkOrGrey(el: Locator, theme: Theme) {
  await expect(el).toBeVisible();
  const found = await paints(el);
  expect(found.length, "something is painted").toBeGreaterThan(0);
  expect(found.filter((c) => !neutral(c))).toEqual([]);
  expect(found).not.toContain(rgb(BASE[theme].mark));
}

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test("paper, surface and ink are the palette's", async ({ page }) => {
      await open(page, theme, "/");
      await expectTokens(page, BASE[theme]);
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
        rgb(BASE[theme].background),
      );
    });

    test("asking for more contrast gives the stronger slots, from the browser or the page", async ({
      page,
    }) => {
      await page.emulateMedia({ contrast: "more" });
      await open(page, theme, "/");
      await expectTokens(page, MORE[theme]);
      await page.emulateMedia({ contrast: "no-preference" });
      await expectTokens(page, BASE[theme]);
      await page.evaluate(() => document.documentElement.setAttribute("data-contrast", "more"));
      await expectTokens(page, MORE[theme]);
    });

    test("a done set and the in-range pill wear the sunk tint and an ink check, no green", async ({
      page,
    }) => {
      await open(page, theme, "/workout?start=A");
      const bench = page.getByRole("region", { name: /^Barbell bench press/ });
      await bench.getByRole("textbox", { name: "Load of set 1, kg" }).fill("80");
      await bench.getByRole("textbox", { name: "Reps of set 1" }).fill("8");
      await bench.getByRole("button", { name: "Log set 1" }).click();
      const check = bench.getByRole("img", { name: "Set 1 logged" });
      await expect(check).toBeVisible();
      const row = bench
        .getByRole("textbox", { name: "Load of set 1, kg" })
        .locator("xpath=ancestor::div[contains(@class, 'grid')][1]");
      const ink = rgb(BASE[theme].foreground);
      const sunk = rgb(BASE[theme].sunk);
      await expect(row).toHaveCSS("background-color", sunk);
      await expectInkOrGrey(row, theme);
      expect(await paints(check.locator("xpath=.."))).toContain(ink);

      await open(page, theme, "/body");
      const pill = page
        .getByRole("region", { name: "Your weeks" })
        .getByRole("listitem")
        .nth(1)
        .locator(":scope > :nth-child(2) > span");
      await expect(pill).toHaveCSS("background-color", sunk);
      await expect(pill).toHaveCSS("color", ink);
      await expect(pill.locator("svg.lucide-check")).toHaveCount(1);
      await expectInkOrGrey(pill, theme);
    });

    test("the selected tab, segment, chip, chart line and body map are ink or grey", async ({
      page,
    }) => {
      await open(page, theme, "/body");
      const nav = page.getByRole("navigation", { name: "Main" });
      await expectInkOrGrey(nav.locator("[aria-current=page]"), theme);
      await expectInkOrGrey(nav.locator("[data-pill]"), theme);
      await expectInkOrGrey(page.locator("polyline.stroke-chart-line").first(), theme);

      await open(page, theme, "/tools/protein");
      const group = page.getByRole("radiogroup", { name: "Your goal" });
      await expectInkOrGrey(group, theme);

      await open(page, theme, "/tools/plates/equipment");
      await page.getByRole("button", { name: "Edit this equipment" }).click();
      await expectInkOrGrey(page.locator("button[aria-pressed=true]").first(), theme);

      await open(page, theme, "/exercises/ds:0025");
      const map = page.locator("figure").first().locator("xpath=../..");
      await expectInkOrGrey(map, theme);
      const [ink] = Object.values(await tokens(page, ["foreground"]));
      expect(Object.values(await tokens(page, ["muscle-primary"]))).toEqual([ink]);
    });

    test("the rail's selected item is ink or grey", async ({ page }) => {
      await open(page, theme, "/body", 800);
      const nav = page.getByRole("navigation", { name: "Main" });
      await expectInkOrGrey(nav.locator("[aria-current=page]"), theme);
      await expectInkOrGrey(nav.locator("[data-pill]"), theme);
    });
  });
}
