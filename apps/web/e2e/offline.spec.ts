import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

async function loadAndGoOffline(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
}

test("the shell and client routes work offline after the first visit", async ({
  page,
  context,
}) => {
  await loadAndGoOffline(page, context);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Belay" })).toBeVisible();
  // The whole sentence: M0 cannot save anything offline yet, so the banner promises nothing.
  await expect(page.getByText("You're offline.", { exact: true })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});

test("every tool works offline after the first visit, without having been opened", async ({
  page,
  context,
}) => {
  await loadAndGoOffline(page, context);
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
  await page.goto("/tools/projection");
  await expect(page.getByRole("region", { name: "Goal reached" })).toContainText("weeks");
  await page.goto("/tools/plates/equipment");
  await expect(page.getByRole("heading", { name: "My equipment", level: 1 })).toBeVisible();
});

test("an offline sign-in attempt is not answered with the cached shell", async ({
  page,
  context,
}) => {
  await loadAndGoOffline(page, context);
  await expect(page.goto("/auth/login")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
});

test("the manifest makes the app installable", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "Belay", display: "standalone", start_url: "/" });
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
});
