import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer, WEEKS } from "./fake-server";
import { asAndroid } from "./native";

// From 600 px the tabs stand in a rail on the left: in a browser up to 1 023 px, where the top bar
// takes over, and at every width in the apps, which never show the top bar.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

// Session A started ten minutes ago, still open.
const RUNNING = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const runningA = (): Change[] => {
  const at = new Date(Date.now() - 10 * 60_000).toISOString();
  return [
    {
      kind: "workout",
      id: RUNNING,
      field: "start",
      sessionCode: "A",
      plan: [...sessionByCode("A", starterProgram)!.slots],
      startedAt: at,
      at,
    },
  ];
};

const TABS = ["Accueil", "Séances", "Corps", "Outils"];
const tabs = (page: Page) => page.getByRole("navigation", { name: "Principale" });
const topBar = (page: Page) => page.getByRole("banner");

async function open(page: Page, path: string, width: number, changes: Change[] = []) {
  await page.setViewportSize({ width, height: 800 });
  await fakeServer(page, { rows: WEEKS, changes });
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.locator("main h1")).toBeVisible();
  await settled(page);
}

// The rail: one column of the four tabs down the left edge, every target 44 px, the page clear.
async function expectRail(page: Page) {
  const nav = tabs(page);
  await expect(nav).toBeVisible();
  const box = (await nav.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.height).toBeGreaterThan(box.width);
  const links = nav.getByRole("link");
  await expect(links).toHaveText(TABS);
  let last = -Infinity;
  for (const link of await links.all()) {
    const b = (await link.boundingBox())!;
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.y).toBeGreaterThan(last);
    last = b.y;
  }
  const main = (await page.locator("main").boundingBox())!;
  expect(main.x).toBeGreaterThanOrEqual(box.x + box.width);
}

// The bar along the bottom, as on a phone.
async function expectBottomBar(page: Page) {
  const nav = tabs(page);
  await expect(nav).toBeVisible();
  const box = (await nav.boundingBox())!;
  expect(box.width).toBeGreaterThan(box.height);
  expect(box.y + box.height).toBeGreaterThan(page.viewportSize()!.height - 100);
}

test.describe("in a browser", () => {
  for (const width of [600, 800, 1023]) {
    test(`at ${width} px the tabs stand in a rail, no bottom bar and no top bar`, async ({
      page,
    }) => {
      await open(page, "/", width);
      await expectRail(page);
      await expect(topBar(page)).toBeHidden();
    });
  }

  test("at 599 px the tabs stay in the bottom bar", async ({ page }) => {
    await open(page, "/", 599);
    await expectBottomBar(page);
  });

  test("at 1 024 px the top bar shows and no rail", async ({ page }) => {
    await open(page, "/", 1024);
    await expect(topBar(page)).toBeVisible();
    await expect(tabs(page)).toBeHidden();
  });
});

test.describe("in the Android app", () => {
  test.beforeEach(async ({ page }) => {
    await asAndroid(page);
  });

  for (const width of [800, 1280]) {
    test(`at ${width} px the rail shows, never the top bar, and Accueil keeps its avatar`, async ({
      page,
    }) => {
      await open(page, "/", width);
      await expectRail(page);
      await expect(topBar(page)).toBeHidden();
      expect(
        await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--top-bar").trim(),
        ),
      ).toBe("0px");
      const avatar = page.locator("main").getByRole("link", { name: "Réglages" });
      await expect(avatar).toBeVisible();
      await avatar.click();
      await expect(page).toHaveURL(/\/settings$/);
      // Réglages is pushed outside the tabs: no rail there.
      await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
      await expect(tabs(page)).toBeHidden();
    });

    test(`at ${width} px the session bar shows beside the rail and opens the cover, which has no rail`, async ({
      page,
    }) => {
      await open(page, "/", width, runningA());
      const bar = page.getByRole("link", { name: /Séance A/ }).and(page.locator("section a"));
      await expect(bar).toBeVisible();
      await settled(page);
      const rail = (await tabs(page).boundingBox())!;
      const box = (await bar.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(rail.x + rail.width);
      expect(box.y + box.height).toBeLessThanOrEqual(800);
      await bar.click();
      await expect(page).toHaveURL(/\/workout\?/);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(tabs(page)).toBeHidden();
    });
  }

  for (const theme of ["light", "dark"] as const) {
    test(`the rail has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await open(page, "/", 800);
      await expectRail(page);
      await expectNoAxeViolations(page);
    });
  }
});

test("crossing 600 px keeps the open weigh-in sheet, the scroll and the page", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 500 });
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  const line = page.getByRole("button", { name: /^Pesée/ });
  await expect(line).toBeVisible();
  await settled(page);
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  const y = Math.min(120, Math.floor(max));
  expect(y).toBeGreaterThan(0);
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
  await line.click();
  const sheet = page.getByRole("dialog", { name: "Pesée" });
  await expect(sheet).toBeVisible();
  await settled(page);
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(() => Object.assign(window, { railMarker: true }));
  for (const width of [599, 800]) {
    await page.setViewportSize({ width, height: 500 });
    await expect(sheet).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(before);
    expect(await page.evaluate(() => "railMarker" in window)).toBe(true);
  }
});

test("the rail brings a tab back on the page it was left on", async ({ page }) => {
  await open(page, "/workouts?tab=exercises", 800);
  await page
    .locator("main")
    .getByRole("link", { name: /^Barbell bench press/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/exercises\//);
  const deep = page.url();
  await expectRail(page);
  await tabs(page).getByRole("link", { name: "Corps" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Corps" })).toBeVisible();
  await tabs(page).getByRole("link", { name: "Séances" }).click();
  await expect(page).toHaveURL(deep);
});
