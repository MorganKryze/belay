import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer, WEEKS } from "./fake-server";

// Wednesday 7 October 2026, 6 p.m. in Paris, on a 1 280 px screen.
const NOW = new Date("2026-10-07T18:00:00+02:00");
test.use({ locale: "en-US", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 800 } });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

// Session C started ten minutes ago, still open: on a phone its bar would sit above the tabs.
const RUNNING = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const TEN_AGO = new Date(NOW.getTime() - 10 * 60_000).toISOString();
const RUNNING_C: Change[] = [
  {
    kind: "workout",
    id: RUNNING,
    field: "start",
    sessionCode: "C",
    plan: [...sessionByCode("C")!.slots],
    startedAt: TEN_AGO,
    at: TEN_AGO,
  },
];

const topBar = (page: Page) => page.getByRole("banner");

test("the top bar replaces the dock and the session bar", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS, changes: RUNNING_C });
  await page.goto("/tools");
  const bar = topBar(page);
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link", { name: "Tools" })).toHaveAttribute("aria-current", "page");
  // The session is known (Séances offers it), yet no bar shows it here.
  await page.goto("/workouts");
  await expect(bar.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  const name = /Set \d+ of \d+ · Session [A-Z]/;
  await expect(page.getByRole("link", { name })).toBeHidden();
  const box = (await bar.boundingBox())!;
  expect(box.y).toBe(0);
  expect(box.width).toBe(1280);
  // The same name does find the session bar on a phone, so the hidden check is not a mismatch.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name })).toBeVisible();
});

test("the avatar opens Réglages", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/body");
  await topBar(page).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
});

test("one avatar link on desktop Accueil", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(1);
  await expect(topBar(page).getByRole("link", { name: "Settings" })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("the title's avatar stays the way to Réglages on a phone", async ({ page }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    const title = page.locator("main h1");
    await expect(title).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(1);
    await expect(title.locator("..").getByRole("link", { name: "Settings" })).toBeVisible();
  });
});

test("a toast sits centred, 400 px wide, 24 px from the bottom", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await page.getByRole("button", { name: /^Weigh-in/ }).click();
  const sheet = page.getByRole("dialog", { name: "Weigh-in" });
  await sheet.getByRole("textbox", { name: "Weight" }).fill("80.5");
  await sheet.getByRole("button", { name: "Save" }).click();
  const undo = page.getByRole("button", { name: "Undo" });
  await expect(undo).toBeVisible();
  await settled(page);
  const card = (await undo.locator("xpath=..").boundingBox())!;
  expect(card.width).toBe(400);
  expect(Math.abs(card.x + card.width / 2 - 640)).toBeLessThanOrEqual(1);
  expect(Math.round(800 - (card.y + card.height))).toBe(24);
});

test("nothing scrolls sideways", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  for (const path of ["/", "/workouts", "/body", "/tools", "/settings"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBe(0);
  }
});

// Réglages grows with each preference, so only Outils is held to one screen.
test("a short page does not scroll under the top bar", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/tools");
  await expect(page.locator("main h1")).toBeVisible();
  const extra = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(extra).toBe(0);
});

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`the top bar has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/body");
      await expect(topBar(page)).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
});
