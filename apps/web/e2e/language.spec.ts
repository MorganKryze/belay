import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

test.describe("in a French browser", () => {
  test.use({ locale: "fr-FR" });

  test("speaks French, and an explicit choice survives a reload", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Se connecter" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    await page.getByRole("link", { name: "Réglages" }).click();
    await page.getByLabel("Langue").click();
    await page.getByRole("option", { name: "English" }).click();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});

test.describe("in a German browser", () => {
  test.use({ locale: "de-DE" });

  test("falls back to English", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  });
});

test("the dark theme applies before the app renders and persists", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Theme").click();
  await page.getByRole("option", { name: "Dark" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});
