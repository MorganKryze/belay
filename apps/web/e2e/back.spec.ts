import { expect, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

test.use({ locale: "fr-FR" });

test.beforeEach(async ({ page }) => {
  await fakeServer(page);
});

test("back from an exercise opened in Exercises keeps « Exercices »", async ({ page }) => {
  const back = page.locator("main").getByRole("link", { name: "Exercices", exact: true });
  await page.goto("/workouts");
  await page.getByRole("radio", { name: "Exercices" }).click();
  await expect(page).toHaveURL(/tab=exercises/);
  await page
    .locator("main")
    .getByRole("link", { name: /^Barbell bench press/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/exercises\//);
  await expect(back).toHaveText("Exercices");
  await back.click();
  await expect(page).toHaveURL(/\/workouts\?tab=exercises$/);
});
