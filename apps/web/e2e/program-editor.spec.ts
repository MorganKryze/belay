import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// The program editor on a computer, the starting program as a new account holds it: session A,
// Push, of six exercises.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 900 } });

const PRESS = "Dumbbell seated shoulder press";

async function open(page: Page, path = "/workouts/program") {
  await fakeServer(page);
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
}
const grid = (page: Page) => page.getByRole("grid");
const row = (page: Page, name: string) => grid(page).getByRole("row").filter({ hasText: name });
// Sets, reps, RIR, rest and warm-ups are the second to sixth cells of a row.
const COLUMN = { sets: 1, reps: 2, rir: 3, rest: 4, warmups: 5 } as const;
const cell = (page: Page, name: string, column: keyof typeof COLUMN) =>
  row(page, name).getByRole("gridcell").nth(COLUMN[column]);
const field = (page: Page) => grid(page).getByRole("textbox");
const size = (page: Page) => page.getByText(/^\d+ exercices · /);
// The page's own width past the window: none means no sideways scroll.
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("a row edited from the keyboard is kept at once, and ⌘ Z or Ctrl Z puts the rest back", async ({
  page,
}) => {
  await open(page);
  await expect(size(page)).toHaveText("6 exercices · 19 séries · environ 55 min");
  await cell(page, PRESS, "sets").click();
  await expect(field(page)).toHaveValue("3");
  await page.keyboard.type("4");
  await page.keyboard.press("Tab");
  await expect(field(page)).toHaveValue("8-10");
  await page.keyboard.type("6-10");
  await page.keyboard.press("Tab");
  await expect(field(page)).toHaveValue("1-2");
  await page.keyboard.press("Tab");
  await expect(field(page)).toHaveValue("2:00");
  await page.keyboard.type("2:30");
  await page.keyboard.press("Enter");
  await expect(field(page)).toHaveCount(0);
  await expect(cell(page, PRESS, "rest")).toBeFocused();

  await expect(cell(page, PRESS, "sets")).toHaveText("4");
  await expect(cell(page, PRESS, "reps")).toHaveText("6–10");
  await expect(cell(page, PRESS, "rest")).toHaveText("2 min 30");
  await expect(size(page)).toHaveText("6 exercices · 20 séries · environ 60 min");
  await expect(page.getByText("Enregistré sur cet appareil")).toBeVisible();

  // The undo key follows the platform the page sees, not the machine running the test: the
  // emulated phone reports Android, so Ctrl even on a Mac.
  const mac = await page.evaluate(() => {
    const { userAgentData } = navigator as Navigator & { userAgentData?: { platform: string } };
    return /mac/i.test(userAgentData?.platform ?? navigator.platform);
  });
  await expect(page.getByText(mac ? /⌘ Z annuler$/ : /Ctrl Z annuler$/)).toBeVisible();
  await page.keyboard.press(mac ? "Meta+z" : "Control+z");
  await expect(cell(page, PRESS, "rest")).toHaveText("2 min");
  await expect(page.getByRole("status").filter({ hasText: "Modification annulée" })).toBeVisible();

  // What the device kept, read again from a fresh page.
  await page.reload();
  await expect(page.locator(".launch")).toBeHidden();
  await expect(cell(page, PRESS, "sets")).toHaveText("4");
  await expect(cell(page, PRESS, "reps")).toHaveText("6–10");
  await expect(cell(page, PRESS, "rest")).toHaveText("2 min");
});

test("the editor lays out 1 024 px wide at 1 280, other pages keep 576", async ({ page }) => {
  await open(page);
  const column = page.getByRole("main").locator("..");
  await expect(grid(page)).toBeVisible();
  expect((await column.boundingBox())!.width).toBe(1024);
  await page.goto("/workouts?tab=program");
  await expect(page.getByRole("heading", { level: 1, name: "Séances" })).toBeVisible();
  expect((await column.boundingBox())!.width).toBe(576);
});

for (const width of [360, 1024]) {
  test(`the editor page does not scroll sideways at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await expect(grid(page)).toBeVisible();
    expect(await overflow(page)).toBe(0);
    await cell(page, PRESS, "reps").click();
    await page.keyboard.type("0");
    await page.keyboard.press("Enter");
    await expect(cell(page, PRESS, "reps").getByRole("alert")).toBeVisible();
    expect(await overflow(page)).toBe(0);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`the program editor has no axe violation, ${scheme}`, async ({ page }) => {
      await open(page);
      await expect(cell(page, PRESS, "sets")).toHaveText("3");
      await expectNoAxeViolations(page);
    });

    test(`an open cell with its error has no axe violation, ${scheme}`, async ({ page }) => {
      await open(page);
      await cell(page, PRESS, "reps").click();
      await expect(field(page)).toHaveValue("8-10");
      await expectNoAxeViolations(page);
      await page.keyboard.type("0");
      await page.keyboard.press("Enter");
      await expect(cell(page, PRESS, "reps").getByRole("alert")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
