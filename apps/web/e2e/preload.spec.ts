import { expect, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T08:00:00+02:00"));
});

// The lazy chunks the page requests from now on, by name ("intake-sheet" for
// chunk-intake-sheet-<hash>.js). The fake clock stands in for `performance`, so its resource
// timings stay empty: the requests are read here instead.
function watch(page: Page) {
  const names: string[] = [];
  page.on("request", (r) => {
    const name = /\/chunk-(.+)-[\w-]{8}\.js$/.exec(new URL(r.url()).pathname)?.[1];
    if (name) names.push(name);
  });
  return names;
}

const SHEETS = ["activity-sheet", "weigh-in-sheet", "intake-sheet", "supplements-sheet"];

test("once Home settles, the sheets are loaded before the first tap", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  const loaded = watch(page);
  await page.goto("/");
  await expect.poll(() => loaded).toEqual(expect.arrayContaining(SHEETS));
  const later = watch(page);
  await page.getByRole("button", { name: /^Intake/ }).click();
  await expect(page.getByRole("dialog", { name: "Intake" })).toBeVisible();
  expect(later).not.toContain("intake-sheet");
});

test("a finger landing on a row loads its sheet before the tap ends", async ({ page }) => {
  // No idle time ever comes, so only the row can ask for the sheet.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  const row = page.getByRole("button", { name: /^Intake/ });
  await expect(row).toBeVisible();
  const later = watch(page);
  await row.dispatchEvent("pointerdown");
  await expect.poll(() => later).toContain("intake-sheet");
  expect(later).not.toContain("weigh-in-sheet");
});

test("a sheet opened a second time opens as the first did", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  const row = page.getByRole("button", { name: /^Intake/ });
  const sheet = page.getByRole("dialog", { name: "Intake" });
  await row.click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  const later = watch(page);
  await row.click();
  await expect(sheet).toBeVisible();
  expect(later).not.toContain("intake-sheet");
});

test("once Home settles, the other tabs are loaded before the first tap", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  const loaded = watch(page);
  await page.goto("/");
  await expect.poll(() => loaded).toEqual(expect.arrayContaining(["workouts", "body", "tools"]));
});

test("touching a tool's link loads its page before the tap ends", async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
  const later = watch(page);
  await page.getByRole("link", { name: /^Energy expenditure/ }).dispatchEvent("touchstart");
  await expect.poll(() => later).toContain("energy");
});
