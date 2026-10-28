import { addDays, toISODate } from "@belay/shared/body/dates";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";
import { asAndroid } from "./native";

// The Android app: the same pages as on the iPhone, worded for Health Connect and the phone.
test.use({ locale: "fr-FR" });

// Signed in to an instance at the preview's own address, with a weigh-in from before the setting
// goes on, so « Envoyer l’historique » offers something.
async function signedIn(page: Page, baseURL: string) {
  await asAndroid(page, { instance: baseURL, token: "a".repeat(43), health: {} });
  await fakeServer(page, { rows: [{ date: addDays(toISODate(new Date()), -10), weightKg: 80 }] });
}

const healthSwitch = (page: Page) => page.getByRole("switch", { name: /^Séances et pesées/ });
const importSwitch = (page: Page) => page.getByRole("switch", { name: /^Importer les pesées/ });
const consent = (page: Page) =>
  page.getByRole("dialog", { name: "Importer tes pesées de Santé Connect ?" });

async function openHealth(page: Page) {
  await page.goto("/settings/health");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Santé Connect" })).toBeVisible();
}

// The page with everything it can show: the setting on, the import on, the history offered.
async function allOn(page: Page) {
  await healthSwitch(page).click();
  await expect(page.getByText("À jour avec Santé Connect")).toBeVisible();
  await importSwitch(page).click();
  await consent(page).getByRole("button", { name: "Importer" }).click();
  await expect(consent(page)).toBeHidden();
  await expect(importSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(
    page.getByRole("button", { name: /^Envoyer l’historique à Santé Connect/ }),
  ).toBeVisible();
}

async function openConsent(page: Page) {
  await healthSwitch(page).click();
  await expect(page.getByText("À jour avec Santé Connect")).toBeVisible();
  await importSwitch(page).click();
  await expect(consent(page)).toBeVisible();
  await settled(page);
}

test("Réglages shows Santé Connect, Désactivé, under Sur ce téléphone", async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL!);
  await page.goto("/settings");
  await expect(page.locator(".launch")).toBeHidden();
  const group = page.getByRole("region", { name: "Sur ce téléphone" });
  const row = group.getByRole("link", { name: /^Santé Connect/ });
  await expect(row).toContainText("Désactivé");
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: "Santé Connect" })).toBeVisible();
});

test("the consent sheet names Santé Connect and the instance", async ({ page, baseURL }) => {
  await signedIn(page, baseURL!);
  await openHealth(page);
  await openConsent(page);
  await expect(consent(page)).toContainText("Les pesées que Santé Connect reçoit");
  await expect(consent(page).locator("strong")).toHaveText(new URL(baseURL!).host);
});

test("the Santé Connect page has no horizontal scroll at 360 px", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await signedIn(page, baseURL!);
  await openHealth(page);
  await allOn(page);
  await settled(page);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`axe violation: Android Health page ${scheme}`, async ({ page, baseURL }) => {
      await signedIn(page, baseURL!);
      await openHealth(page);
      await allOn(page);
      await expectNoAxeViolations(page);
    });

    test(`axe violation: Android consent sheet ${scheme}`, async ({ page, baseURL }) => {
      await signedIn(page, baseURL!);
      await openHealth(page);
      await openConsent(page);
      await expectNoAxeViolations(page);
    });
  });
}
