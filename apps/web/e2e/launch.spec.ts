import { expect, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

test.use({ locale: "en-US" });

test("a signed-in launch never shows the signed-out header", async ({ page }) => {
  await fakeServer(page);
  // Every heading the page has held, taken at each DOM change from the first byte on: a frame
  // that lasts a few milliseconds still lands here.
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { seenHeadings: Set<string> }).seenHeadings = seen;
    new MutationObserver(() => {
      for (const h of document.querySelectorAll("h1")) seen.add(h.textContent ?? "");
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  const seen = await page.evaluate(() => [
    ...(window as unknown as { seenHeadings: Set<string> }).seenHeadings,
  ]);
  expect(seen).not.toContain("Belay");
});

test("the launch screen stays until the account is known, then leaves", async ({ page }) => {
  await fakeServer(page);
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route("**/api/me", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/");
  await page.waitForFunction(() => document.getElementById("root")!.childElementCount > 0);
  await expect(page.locator(".launch")).toBeVisible();
  answer();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
});

test("with reduced motion the launch screen leaves at once, without a fade", async ({ page }) => {
  await fakeServer(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The screen's visibility the moment it is told to leave: a fade would keep it visible.
  await page.addInitScript(() => {
    const at: string[] = [];
    (window as unknown as { leaving: string[] }).leaving = at;
    new MutationObserver(() => {
      const launch = document.querySelector(".launch");
      if (launch && document.body.classList.contains("launched") && at.length === 0)
        at.push(getComputedStyle(launch).visibility);
    }).observe(document, { attributes: true, attributeFilter: ["class"], subtree: true });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { leaving: string[] }).leaving)).toEqual([
    "hidden",
  ]);
});

test("an account question that never gets an answer lets the launch screen go after 4 s", async ({
  page,
}) => {
  await fakeServer(page);
  // No remembered user in a fresh context, and /api/me never answers.
  await page.route("**/api/me", () => {});
  await page.goto("/");
  await page.waitForFunction(() => document.getElementById("root")!.childElementCount > 0);
  await expect(page.locator(".launch")).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden({ timeout: 4_500 });
});
