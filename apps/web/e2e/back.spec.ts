import { expect, type Locator, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// Short enough that the Programme scrolls once two sessions are open.
test.use({ locale: "fr-FR", viewport: { width: 390, height: 600 } });

const B = "Séance B · Legs";
const C = "Séance C · Fessiers + tirage léger";

test.beforeEach(async ({ page }) => {
  // Counts the page transitions the router starts.
  await page.addInitScript(() => {
    const w = window as unknown as { transitions: number };
    w.transitions = 0;
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((arg: StartViewTransitionOptions) => {
      w.transitions += 1;
      return start(arg);
    }) as typeof document.startViewTransition;
  });
  await fakeServer(page);
});

const transitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { transitions: number }).transitions);
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const entry = (page: Page) =>
  page.evaluate(() => (history.state as { __TSR_index: number }).__TSR_index);
const card = (page: Page, name: string) => page.getByRole("region", { name });
const see = (page: Page, name: string) => card(page, name).getByRole("button", { name: "Voir" });
const back = (page: Page) =>
  page.locator("main").getByRole("link", { name: /^(Programme|Exercices)$/ });

async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await expect.poll(() => scrollY(page)).toBe(y);
}

// The first link of the list that sits well inside the viewport, so tapping it scrolls nothing.
async function visibleLink(list: Locator, page: Page) {
  const height = page.viewportSize()!.height;
  for (const link of await list.getByRole("link").all()) {
    const box = await link.boundingBox();
    if (box && box.y > 120 && box.y + box.height < height - 120) return link;
  }
  throw new Error("no exercise in view");
}

async function openProgram(page: Page) {
  await page.goto("/workouts");
  await page.getByRole("radio", { name: "Programme" }).click();
  await expect(page).toHaveURL(/tab=program/);
  await expect(see(page, B)).toBeVisible();
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test.describe(`with motion ${reducedMotion}`, () => {
    test.use({ reducedMotion });

    test("back from an exercise opened in the Programme returns to the open session where it was left", async ({
      page,
    }) => {
      await openProgram(page);
      await see(page, C).click();
      await see(page, B).click();
      await expect(see(page, B)).toHaveAttribute("aria-expanded", "true");
      await expect(see(page, C)).toHaveAttribute("aria-expanded", "true");
      await scrollTo(page, 300);
      const program = await entry(page);
      const exercise = await visibleLink(card(page, B).getByRole("list"), page);
      await exercise.click();
      await expect(page).toHaveURL(/\/exercises\//);
      await expect(back(page)).toHaveText("Programme");
      const before = await transitions(page);
      await back(page).click();
      await expect(page).toHaveURL(/\/workouts\?/);
      const url = new URL(page.url());
      expect(url.searchParams.get("tab")).toBe("program");
      expect(url.searchParams.get("see")).toBe("B,C");
      await expect(see(page, B)).toHaveAttribute("aria-expanded", "true");
      await expect(see(page, C)).toHaveAttribute("aria-expanded", "true");
      await expect.poll(async () => Math.abs((await scrollY(page)) - 300)).toBeLessThanOrEqual(2);
      // It went back to the Programme's own entry, with one slide.
      expect(await entry(page)).toBe(program);
      await expect.poll(() => transitions(page)).toBe(before + 1);
    });

    test("Voir opens and folds a session in place", async ({ page }) => {
      await openProgram(page);
      await see(page, C).click();
      await expect(see(page, C)).toHaveAttribute("aria-expanded", "true");
      await scrollTo(page, 300);
      const length = await page.evaluate(() => history.length);
      const before = await transitions(page);
      await see(page, B).click();
      await expect(see(page, B)).toHaveAttribute("aria-expanded", "true");
      await expect(page).toHaveURL(/\/workouts\?tab=program&see=B(%2C|,)C$/);
      expect(Math.abs((await scrollY(page)) - 300)).toBeLessThanOrEqual(2);
      await see(page, B).click();
      await expect(see(page, B)).toHaveAttribute("aria-expanded", "false");
      await expect(page).toHaveURL(/\/workouts\?tab=program&see=C$/);
      // The address changed in place: no entry, no page transition.
      expect(await page.evaluate(() => history.length)).toBe(length);
      expect(await transitions(page)).toBe(before);
    });
  });
}

test("back from an exercise opened in Exercises keeps « Exercices »", async ({ page }) => {
  await page.goto("/workouts");
  await page.getByRole("radio", { name: "Exercices" }).click();
  await expect(page).toHaveURL(/tab=exercises/);
  await page
    .locator("main")
    .getByRole("link", { name: /^Barbell bench press/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/exercises\//);
  await expect(back(page)).toHaveText("Exercices");
  await back(page).click();
  await expect(page).toHaveURL(/\/workouts\?tab=exercises$/);
});

test("an exercise from the Programme opened on its own leads to the Programme with its sessions open, at the top", async ({
  page,
}) => {
  await page.goto("/exercises/ds:0043?from=program&see=B");
  await expect(back(page)).toHaveText("Programme");
  const length = await page.evaluate(() => history.length);
  await back(page).click();
  await expect(see(page, B)).toHaveAttribute("aria-expanded", "true");
  expect(await scrollY(page)).toBe(0);
  // Nothing to go back to: it opened the Programme as a new entry.
  expect(await page.evaluate(() => history.length)).toBe(length + 1);
});
