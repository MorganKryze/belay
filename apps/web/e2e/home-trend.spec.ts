import { addDays } from "@belay/shared/body/dates";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// On the real clock, in English: "today" is the real date in Paris.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// A weigh-in on each of the last 21 days at 80.4 kg: an average to show whatever the weekday.
async function openHome(page: Page) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const rows = Array.from({ length: 21 }, (_, i) => ({ date: addDays(today, -i), weightKg: 80.4 }));
  await fakeServer(page, { rows });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
}

const trendCard = (page: Page) => page.getByRole("link", { name: /^7-day average/ });

test("the figure is 50 px bold with tabular figures and the whole card opens Body", async ({
  page,
}) => {
  await openHome(page);
  const card = trendCard(page);
  await expect(card).toContainText("80.4kg");
  const figure = card.locator("[data-slot=trend-figure]");
  await expect(figure).toHaveCSS("font-size", "50px");
  await expect(figure).toHaveCSS("font-weight", "700");
  await expect(figure).toHaveCSS("font-variant-numeric", "tabular-nums");
  await expect(figure).toHaveCSS("letter-spacing", "-1.5px");
  await expect(figure.locator("span")).toHaveCSS("font-size", "17px");
  // A tap near the card's bottom-right corner, far from the words, still opens Body.
  const box = (await card.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width - 8, box.y + box.height - 6);
  await expect(page).toHaveURL(/\/body$/);
});

test("hidden in Settings, Accueil shows no trend after Back, and Body still does", async ({
  page,
}) => {
  await openHome(page);
  await expect(trendCard(page)).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("combobox", { name: /^Trend · / }).tap();
  await page.getByRole("option", { name: "Hidden" }).tap();
  await expect(page.getByRole("combobox", { name: "Trend · Hidden" })).toBeVisible();
  await page.getByRole("link", { name: "Home" }).first().tap();
  await expect(page.getByRole("heading", { name: "Hello, Ada", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your trend" })).toHaveCount(0);
  await expect(trendCard(page)).toHaveCount(0);
  await page.goto("/body");
  await expect(page.getByText("7-day average", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("80.4kg").first()).toBeVisible();
});
