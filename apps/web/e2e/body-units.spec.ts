import { addDays } from "@belay/shared/body/dates";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// On the real clock, in French: "today" is the real date in Paris.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
// Four weeks of weigh-ins stored in kg, down to 80.4 kg today (177,3 lb): an average and a weekly
// loss to show whatever the weekday.
const drifting = (from = 0) =>
  Array.from({ length: 28 - from }, (_, i) => ({
    date: addDays(today(), -(i + from)),
    weightKg: Math.round((80.4 + (i + from) * 0.05) * 10) / 10,
  }));

// The unit is a device preference, set before the app reads it.
async function open(page: Page, path: string, rows = drifting()) {
  await page.addInitScript(() => localStorage.setItem("belay.weightUnit", "lb"));
  const server = await fakeServer(page, { rows });
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  return server;
}

const weighInRow = (page: Page) => page.getByRole("button", { name: /^Pesée/ });

test("Accueil reads the weigh-in and the 7-day average in lb", async ({ page }) => {
  await open(page, "/");
  await expect(weighInRow(page)).toContainText("177,3 lb");
  const trend = page.getByRole("link", { name: /^Moyenne 7 jours/ });
  const figure = trend.locator("[data-slot=trend-figure]");
  await expect(figure).toHaveText(/^\d{3},\dlb$/);
  await expect(figure.locator("span")).toHaveText("lb");
  await expect(trend).not.toContainText("kg");
  await expect(weighInRow(page)).not.toContainText("kg");
});

test("Corps reads its figure, weeks and history in lb, the loss still in %", async ({ page }) => {
  await open(page, "/body");
  const figure = page.getByRole("region", { name: "Moyenne 7 jours" });
  await expect(figure.locator("[data-slot=trend-figure]")).toHaveText(/^\d{3},\dlb$/);
  await expect(figure).toContainText("%");
  const weeks = page.getByRole("region", { name: "Tes semaines" });
  await expect(weeks).toContainText(/\d{3},\d\slb/);
  await expect(weeks).toContainText("%");
  await expect(weeks).not.toContainText("kg");
  const history = page.getByRole("region", { name: "Historique" });
  await expect(history).toContainText("177,3 lb");
  await expect(history).not.toContainText("kg");
  await expect(page.getByRole("button", { name: /^Pesée/ }).first()).toContainText("177,3 lb");
  await expect(page.getByRole("img", { name: /^Pesées du/ })).toHaveAccessibleName(
    /Moyenne 7 jours\s: \d{3},\d\slb\./,
  );
});

test("the chart's last average and tooltip say lb", async ({ page }) => {
  await open(page, "/body");
  const chart = page.getByRole("img", { name: /^Pesées du/ });
  await expect(chart).toBeVisible();
  await expect(chart.locator("text[data-slot=last-average]")).toHaveText(/^1\d\d,\d$/);
  // The axis reads whole pounds, near the weigh-ins: its labels end left of the plot, at x 20.
  const ticks = await chart.locator('text[x="20"]').allTextContents();
  expect(ticks.length).toBeGreaterThan(1);
  for (const t of ticks) expect(Number(t)).toBeGreaterThan(150);
  await chart.focus();
  const tip = page.locator("[aria-live=polite]");
  await expect(tip).toContainText("Pesée 177,3 lb");
  await expect(tip).toContainText(/Moyenne 7 j 1\d\d,\d\slb/);
  await expect(tip).not.toContainText("kg");
});

test("a weigh-in typed 180,4 lb reads back within 0,1 lb", async ({ page }) => {
  // Nothing today yet: the field is prefilled from yesterday's 80.5 kg.
  const server = await open(page, "/", drifting(1));
  await weighInRow(page).tap();
  const sheet = page.getByRole("dialog", { name: "Pesée" });
  const field = sheet.getByRole("textbox", { name: "Poids" });
  await expect(field).toHaveValue("177,5");
  await expect(sheet.getByText("lb", { exact: true })).toBeVisible();
  await field.fill("180,4");
  await sheet.getByRole("button", { name: "Enregistrer" }).tap();
  await expect(sheet).toBeHidden();
  // Stored as 81.8 kg, read back as 180,3 lb.
  await expect(weighInRow(page)).toContainText("180,3 lb");
  await expect.poll(() => server.rows.get(today())?.weightKg).toBe(81.8);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`Corps in pounds has no axe violation, ${scheme}`, async ({ page }) => {
      await open(page, "/body");
      await expect(page.getByRole("region", { name: "Historique" })).toContainText("177,3 lb");
      await expectNoAxeViolations(page);
    });
  });
}

test("the Accueil weigh-in row fits at 360 px in pounds", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  // A five-digit reading: 140 kg is 308,6 lb.
  await open(page, "/", [{ date: today(), weightKg: 140 }]);
  const row = weighInRow(page);
  await expect(row).toContainText("308,6 lb");
  const [rowBox, textBox] = [
    (await row.boundingBox())!,
    (await row.getByText("308,6 lb").boundingBox())!,
  ];
  expect(textBox.x + textBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
  expect(textBox.height).toBeLessThan(24);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
