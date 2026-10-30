import { addDays, toISODate } from "@belay/shared/body/dates";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";
import { asAndroid, barStyles, healthRequests } from "./native";

// The Android app: the same pages as on the iPhone, worded for Health Connect and the phone.
test.use({ locale: "fr-FR" });

type Health = NonNullable<Parameters<typeof asAndroid>[1]>["health"];

const today = () => toISODate(new Date());

// Signed in to an instance at the preview's own address, with a weigh-in from before the setting
// goes on, so « Envoyer l’historique » offers something.
async function signedIn(page: Page, baseURL: string, health: Health = {}) {
  await asAndroid(page, { instance: baseURL, token: "a".repeat(43), health });
  return fakeServer(page, { rows: [{ date: addDays(today(), -10), weightKg: 80 }] });
}

const healthSwitch = (page: Page) => page.getByRole("switch", { name: /^Séances et pesées/ });
const importSwitch = (page: Page) => page.getByRole("switch", { name: /^Importer les pesées/ });
const consent = (page: Page) =>
  page.getByRole("dialog", { name: "Importer tes pesées de Santé Connect ?" });
const historyAction = (page: Page) =>
  page.getByRole("button", { name: /^Importer l’historique de Santé Connect/ });

const WINDOW = "Santé Connect ne remonte qu’à 30 jours avant ta première autorisation.";
// The instant the history's read starts from, the earliest both phones accept.
const HISTORY_SINCE = Date.UTC(1899, 11, 31);

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

test("the system bars follow the theme, the phone's own included", async ({ page, baseURL }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await signedIn(page, baseURL!);
  await page.goto("/settings");
  await expect(page.locator(".launch")).toBeHidden();
  await expect.poll(async () => (await barStyles(page)).at(-1)).toBe("DARK");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(async () => (await barStyles(page)).at(-1)).toBe("LIGHT");
});

test("the history asks Health Connect's permission, then imports", async ({ page, baseURL }) => {
  const day = addDays(today(), -60);
  const server = await signedIn(page, baseURL!, {
    history: "undetermined",
    grantHistory: true,
    samples: [{ startedAt: new Date(`${day}T07:00:00`).getTime(), kg: 78.4 }],
  });
  await openHealth(page);
  await allOn(page);
  await historyAction(page).click();
  await expect(page.getByText("Historique importé")).toBeVisible();
  await expect.poll(() => server.rows.get(day)?.weightKg).toBe(78.4);
  const requests = await healthRequests(page);
  const asked = requests.findIndex((r) => r.op === "authorize" && r.scope === "history");
  const read = requests.findIndex((r) => r.op === "readWeighings" && r.since === HISTORY_SINCE);
  expect(asked).toBeGreaterThanOrEqual(0);
  expect(read).toBeGreaterThan(asked);
  await expect(page.getByText(WINDOW)).toHaveCount(0);
});

test("without the history feature the done row says the 30-day window", async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL!, { history: "unavailable" });
  await openHealth(page);
  await allOn(page);
  await historyAction(page).click();
  await expect(page.getByText("Historique importé")).toBeVisible();
  await expect(page.getByText(WINDOW)).toContainText(
    "Cette version de Santé Connect ne donne pas les pesées plus anciennes.",
  );
  await expect(page.getByRole("button", { name: /^Importer les plus anciennes/ })).toHaveCount(0);
  expect(await healthRequests(page)).not.toContainEqual({ op: "authorize", scope: "history" });
});

const isHistoryRead = (r: Record<string, unknown>) =>
  r.op === "readWeighings" && r.since === HISTORY_SINCE;

test("the next Tab after « Importer les plus anciennes » finds it again", async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL!, { history: "denied" });
  await openHealth(page);
  await allOn(page);
  await historyAction(page).click();
  const older = page.getByRole("button", { name: /^Importer les plus anciennes/ });
  await older.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("region", { name: "Depuis Santé Connect" }).getByRole("status"),
  ).toBeFocused();
  // The second read is what takes the row away and brings it back.
  await expect.poll(async () => (await healthRequests(page)).filter(isHistoryRead).length).toBe(2);
  await expect(older).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(older).toBeFocused();
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
