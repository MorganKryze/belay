import type { Change } from "@belay/shared/sync/schema";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

// Wednesday 7 October 2026, 8 a.m. in Paris; timers still run, only the date is fixed.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T08:00:00+02:00"));
});

const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
// What another device already sent: a profile, a supplement and the last measurements.
const ON_SERVER: Change[] = [
  { kind: "profile", field: "formula", value: "male", at: AT },
  { kind: "profile", field: "birthYear", value: 1995, at: AT },
  { kind: "profile", field: "height", value: 178, at: AT },
  { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
  { kind: "measure", date: "2026-10-06", field: "waist", value: 82, at: AT },
  { kind: "measure", date: "2026-10-06", field: "neck", value: 39, at: AT },
];

// Signed in, the first sync done on Home, the profile on the phone.
async function signedIn(page: Page) {
  await fakeServer(page, { rows: WEEKS, changes: ON_SERVER });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("button", { name: /^Supplements/ })).toContainText("0 of 1");
}

// A Réglages row found by the start of its visible label.
async function choose(page: Page, label: RegExp, option: string) {
  await page.goto("/settings");
  await expect(page.locator(".launch")).toBeHidden();
  await page.getByRole("combobox").filter({ hasText: label }).tap();
  await page.getByRole("option", { name: option }).tap();
  await expect(page.getByRole("combobox").filter({ hasText: label })).toContainText(option);
}

test("chosen in Settings, field sources leave Energy and Body fat", async ({ page }) => {
  await signedIn(page);
  await page.goto("/tools/energy");
  await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("178");
  await expect(page.getByText("from your year of birth")).toBeVisible();
  await choose(page, /^Field sources/, "Hidden");
  await page.goto("/tools/energy");
  await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("178");
  await expect(page.getByRole("textbox", { name: "Age" })).toHaveValue("31");
  await expect(page.getByText(/^from your/)).toHaveCount(0);
  await expect(page.getByText("your 7-day average")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to my last entries" })).toBeVisible();
  await page.goto("/tools/body-fat");
  await expect(page.getByRole("textbox", { name: "Neck" })).toHaveValue("39");
  await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("178");
  await expect(page.getByText(/^(from your|measured on)/)).toHaveCount(0);
});

test("chosen in Settings, Epley only leaves one figure on the 1RM", async ({ page }) => {
  await signedIn(page);
  const figures = page
    .getByRole("region", { name: "Your estimated 1RM" })
    .locator("[data-slot=result-figure]");
  await page.goto("/tools/one-rep-max");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(figures).toHaveCount(2);
  await choose(page, /^1RM/, "Epley only");
  await page.goto("/tools/one-rep-max");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(figures).toHaveCount(1);
  const box = await figures.first().boundingBox();
  expect(box?.height).toBeGreaterThan(0);
});

test("hidden in Settings, field sources leave Energy in the same visit, with no reload", async ({
  page,
}) => {
  await signedIn(page);
  await page.evaluate(() => ((window as unknown as { sameVisit: boolean }).sameVisit = true));
  const tools = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tools" });
  await tools.tap();
  await page.getByRole("link", { name: /^Energy expenditure/ }).tap();
  await expect(page.getByText("from your year of birth")).toBeVisible();
  await page.goBack();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).tap();
  await page.getByRole("link", { name: "Settings" }).tap();
  await page
    .getByRole("combobox")
    .filter({ hasText: /^Field sources/ })
    .tap();
  await page.getByRole("option", { name: "Hidden" }).tap();
  await expect(page.getByRole("combobox").filter({ hasText: /^Field sources/ })).toContainText(
    "Hidden",
  );
  await page.goBack(); // Réglages is pushed over Home, the tabs come back with it
  await tools.tap();
  await page.getByRole("link", { name: /^Energy expenditure/ }).tap();
  await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("178");
  await expect(page.getByText(/^from your/)).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { sameVisit?: boolean }).sameVisit)).toBe(
    true,
  );
});
