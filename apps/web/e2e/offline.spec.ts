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
  await expect(page.getByText("You're offline.", { exact: false })).toBeVisible();

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
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
