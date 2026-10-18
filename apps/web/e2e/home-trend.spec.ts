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
