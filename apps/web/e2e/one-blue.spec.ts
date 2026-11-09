import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

// Blue is one role: the screen's next action. Everything else is ink and grey, so the eye goes to
// the one thing to do; where there is nothing to do, there is no blue at all.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// Wednesday 7 October 2026, 6 p.m. in Paris, the day the fixture's weeks lead up to.
const NOW = new Date("2026-10-07T18:00:00+02:00");
const freeze = (page: Page) => page.clock.setFixedTime(NOW);

type Theme = "light" | "dark";

// A colour token as the page paints it.
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("i");
    probe.style.color = `var(--${n})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);

// The accessible names of the visible things painted in the theme's mark blue: a fill, an edge, a
// text of their own, or an SVG fill or stroke. A blue part of a control counts as the control. The
// focus ring is an outline, never read here.
async function blueTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.color = "var(--mark)";
    document.body.append(probe);
    const mark = getComputedStyle(probe).color;
    probe.remove();
    const control =
      "a, button, input, select, textarea, [role=button], [role=link], [role=radio], [role=tab], [role=switch], [role=checkbox]";
    const nameOf = (el: Element) =>
      (
        el.getAttribute("aria-label") ??
        (el instanceof HTMLElement ? el.innerText : (el.textContent ?? ""))
      )
        .trim()
        .replace(/\s+/g, " ");
    const found = new Set<string>();
    for (const el of document.body.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const s = getComputedStyle(el);
      const ownText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "",
      );
      const edges = (["Top", "Right", "Bottom", "Left"] as const)
        .filter((side) => parseFloat(s[`border${side}Width`]) > 0)
        .map((side) => s[`border${side}Color`]);
      const svg = el instanceof SVGElement ? [s.fill, s.stroke] : [];
      const paints = [s.backgroundColor, ...edges, ...svg, ...(ownText ? [s.color] : [])];
      if (!paints.includes(mark)) continue;
      const target = el.closest(control) ?? el;
      found.add(nameOf(target) || target.tagName.toLowerCase());
    }
    return [...found];
  });
}

async function open(page: Page, theme: Theme) {
  await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
}

// Session A on Monday, ended: the summary has its figures.
const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const MONDAY = "2026-10-05T16:00:00.000Z";
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt: MONDAY,
    at: MONDAY,
  },
  { kind: "workout", id: LAST, field: "ended", value: "2026-10-05T17:04:00.000Z", at: MONDAY },
];

// Session A started at 17:40 and still running at the frozen 18:00.
const OPEN = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e02";
const STARTED = "2026-10-07T15:40:00.000Z";
const RUNNING_A: Change[] = [
  {
    kind: "workout",
    id: OPEN,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt: STARTED,
    at: STARTED,
  },
];

// Session A done this afternoon: Accueil has nothing left to start today.
const DONE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e03";
const AFTERNOON = "2026-10-07T13:00:00.000Z";
const DONE_A: Change[] = [
  {
    kind: "workout",
    id: DONE,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt: AFTERNOON,
    at: AFTERNOON,
  },
  { kind: "workout", id: DONE, field: "ended", value: "2026-10-07T14:05:00.000Z", at: AFTERNOON },
];

const homeReady = (page: Page) =>
  expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();

// The eight key screens and the one blue each shows: none where nothing is to be started. On the
// cover the set's check stays neutral and the rest bar draws its thread in its own blue.
const SCREENS: [string, string[], (page: Page) => Promise<void>][] = [
  [
    "Home",
    ["See the session"],
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await homeReady(page);
      await expect(page.getByRole("link", { name: "See the session" })).toBeVisible();
    },
  ],
  [
    "Sessions",
    ["See the session"],
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workouts?tab=program");
      await expect(page.getByRole("radio", { name: /program/i })).toBeChecked();
      await expect(page.getByRole("link", { name: "See the session" })).toBeVisible();
    },
  ],
  [
    "the session cover",
    [],
    async (page) => {
      await fakeServer(page, { changes: RUNNING_A });
      await page.goto("/");
      await page.getByRole("region", { name: "Session in progress" }).getByRole("link").click();
      await expect(page.getByRole("button", { name: "Minimize the session" })).toBeVisible();
    },
  ],
  [
    "the summary",
    ["Save"],
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto(`/workout/summary/${LAST}`);
      await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
    },
  ],
  [
    "Body",
    [],
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/body");
      await expect(page.locator("main h1").first()).toBeVisible();
    },
  ],
  [
    "the weigh-in sheet",
    ["Save"],
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await homeReady(page);
      await page.getByRole("button", { name: /^Weigh-in/ }).click();
      await expect(page.getByRole("dialog", { name: "Weigh-in" })).toBeVisible();
    },
  ],
  [
    "Tools",
    [],
    async (page) => {
      await fakeServer(page);
      await page.goto("/tools");
      await expect(page.locator("main h1").first()).toBeVisible();
    },
  ],
  [
    "Settings",
    [],
    async (page) => {
      await fakeServer(page);
      await page.goto("/settings");
      await expect(page.locator("main h1").first()).toBeVisible();
    },
  ],
];

// Home's other sheets: each holds its own one blue, its save, once there is something to save.
const SHEETS: [string, RegExp, (page: Page) => Promise<void>][] = [
  ["Activity", /^Activity/, async () => {}],
  [
    "Intake",
    /^Intake/,
    (page) =>
      page
        .getByRole("dialog")
        .getByRole("textbox", { name: /^Calories/ })
        .fill("2400"),
  ],
];

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test.beforeEach(async ({ page }) => {
      await freeze(page);
      await open(page, theme);
    });

    for (const [name, expected, reach] of SCREENS) {
      test(`${name} shows its next action as its one blue`, async ({ page }) => {
        await reach(page);
        await expect(page.locator(".launch")).toBeHidden();
        expect(await blueTargets(page)).toEqual(expected);
      });
    }

    for (const [name, opener, fill] of SHEETS) {
      test(`the ${name} sheet keeps the blue for its save`, async ({ page }) => {
        await fakeServer(page, { rows: WEEKS });
        await page.goto("/");
        await homeReady(page);
        await page.getByRole("button", { name: opener }).click();
        const sheet = page.getByRole("dialog").first();
        await expect(sheet).toBeVisible();
        await fill(page);
        await expect(page.locator(".launch")).toBeHidden();
        expect(await blueTargets(page)).toEqual(["Save"]);
      });
    }

    test("under the weigh-in sheet the page's action gives up its blue", async ({ page }) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await homeReady(page);
      // The launch mark is blue standing alone: read the page once the launch has faded out.
      await expect(page.locator(".launch")).toBeHidden();
      // Located by its markup: under the sheet the page is hidden from the accessibility tree.
      const see = page.locator('main a[data-variant="primary"]');
      expect(await blueTargets(page)).toEqual(["See the session"]);
      await page.getByRole("button", { name: /^Weigh-in/ }).click();
      const sheet = page.getByRole("dialog", { name: "Weigh-in" });
      await expect(sheet).toBeVisible();
      // The sheet rises over the page: read once it holds its own action.
      await expect.poll(() => blueTargets(page)).toEqual(["Save"]);
      const track = await token(page, "track");
      await expect(see).toHaveCSS("background-color", track);
      await sheet.press("Escape");
      await expect(sheet).toBeHidden();
      await expect.poll(() => blueTargets(page)).toEqual(["See the session"]);
    });

    test("with today's session done, Home shows no blue", async ({ page }) => {
      await fakeServer(page, { rows: WEEKS, changes: DONE_A });
      await page.goto("/");
      await homeReady(page);
      await expect(page.getByText(/^Done today/)).toBeVisible();
      await expect(page.locator(".launch")).toBeHidden();
      expect(await blueTargets(page)).toEqual([]);
    });

    test.describe("at 1 280 px", () => {
      test.use({ viewport: { width: 1280, height: 800 } });

      for (const path of ["/", "/workouts", "/body", "/tools"]) {
        test(`the ${path} tab root shows at most one blue`, async ({ page }) => {
          await fakeServer(page, { rows: WEEKS, changes: LAST_A });
          await page.goto(path);
          await expect(page.locator("main h1").first()).toBeVisible();
          await expect(page.locator(".launch")).toBeHidden();
          expect((await blueTargets(page)).length).toBeLessThanOrEqual(1);
        });
      }

      test("the top bar draws the mark and the active section in ink", async ({ page }) => {
        await fakeServer(page, { rows: WEEKS });
        await page.goto("/");
        const bar = page.getByRole("banner");
        await expect(bar).toBeVisible();
        const ink = await page.evaluate(() => getComputedStyle(document.body).color);
        await expect(bar.locator("svg path").first()).toHaveCSS("fill", ink);
        await expect(bar.locator("nav [aria-current=page]")).toHaveCSS("color", ink);
        const blue = await blueTargets(page);
        expect(blue).not.toContain("Belay");
        expect(blue).not.toContain("Home");
      });
    });
  });
}

// The mark standing alone is blue. No fake clock: the router times its pending page with
// Date.now(). The service worker is kept out so the held chunk is not served from its cache.
test.describe("the loader", () => {
  test.use({ serviceWorkers: "block" });
  for (const theme of ["light", "dark"] as const) {
    test(`draws the mark in blue, ${theme}`, async ({ page }) => {
      await open(page, theme);
      await page.addInitScript(() => {
        window.requestIdleCallback = () => 0;
      });
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await homeReady(page);
      await expect(page.locator(".launch")).toBeHidden();
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      await page.route(/\/chunk-body-[\w-]{8}\.js$/, async (route) => {
        await released;
        await route.continue();
      });
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Body" })
        .click();
      const hook = page.locator("[data-pending] .loader-mark > [data-hook]").first();
      await expect(hook).toBeVisible();
      const mark = await token(page, "mark");
      await expect(hook).toHaveCSS("background-color", mark);
      release();
    });
  }
});
