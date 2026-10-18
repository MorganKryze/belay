import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";

// Signed in as Ada, in English.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const row = (page: Page, name: "Language" | "Theme") =>
  page.getByRole("combobox", { name: new RegExp(`^${name}`) });

async function openSettings(page: Page, theme?: "light" | "dark") {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page);
  await page.goto("/settings");
  await expect(row(page, "Language")).toBeVisible();
}

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const menu of ["Language", "Theme"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`Réglages with the ${menu} menu open has no axe violation, ${theme}`, async ({
        page,
      }) => {
        await openSettings(page, theme);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        await row(page, menu).click();
        await expect(page.getByRole("listbox")).toBeVisible();
        await expectNoAxeViolations(page);
      });
    }
  }
});

test("a menu opens from the keyboard and gives the focus back to its row", async ({ page }) => {
  await openSettings(page, "light");
  const theme = row(page, "Theme");
  const menu = page.getByRole("listbox");

  await theme.focus();
  await page.keyboard.press("Enter");
  // The menu opens on the current choice, then the arrow moves to the next one.
  await expect(page.getByRole("option", { name: "Light" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Dark" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(theme).toHaveAccessibleName("Theme Dark");
  await expect(theme).toBeFocused();

  await page.keyboard.press("Space");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(theme).toBeFocused();

  await theme.click();
  await expect(menu).toBeVisible();
  const title = (await page.locator("main h1").boundingBox())!;
  await page.mouse.click(title.x + 4, title.y + title.height / 2);
  await expect(menu).toBeHidden();
  await expect(theme).toBeFocused();
});

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("the preference rows follow the kit at 360 px", async ({ page }) => {
    await openSettings(page);
    await settled(page);
    for (const name of ["Language", "Theme"] as const) {
      const trigger = row(page, name);
      const box = (await trigger.boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(52);
      const square = (await trigger.locator("[data-slot=row-icon]").boundingBox())!;
      expect([square.width, square.height], name).toEqual([28, 28]);
      const chevron = trigger.locator("[data-slot=row-chevron]");
      await expect(chevron).toHaveClass(/lucide-chevron-down/);
      const value = (await trigger.locator("[data-slot=select-value]").boundingBox())!;
      const arrow = (await chevron.boundingBox())!;
      expect(value.x + value.width, name).toBeLessThanOrEqual(arrow.x);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
