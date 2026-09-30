import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

test("a failed sign-in explains itself in the installed app, once", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  // What the server answers when the identity provider is down; the service worker serves the shell.
  await page.goto("/?signin=unavailable");
  await expect(page.getByRole("alert")).toHaveText(
    "Sign-in is unavailable right now. Try again in a moment.",
  );
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  await page.reload();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
