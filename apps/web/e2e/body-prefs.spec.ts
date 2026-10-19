import { addDays, isoWeekStart } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// On the real clock, in English: "today" is the real date in Paris, the fixtures built from it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const AT = "2026-10-01T06:30:00.000Z";

// Two complete weeks before this one: 80.8 kg, then 80.2 kg, a loss of 0.7 % in the default range;
// an intake on the last complete week's Monday.
async function openHome(page: Page) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const last = addDays(isoWeekStart(today), -7);
  const before = addDays(last, -7);
  const rows = [0, 1, 2, 3].flatMap((d) => [
    { date: addDays(before, d), weightKg: 80.8 },
    { date: addDays(last, d), weightKg: 80.2 },
  ]);
  const changes: Change[] = [{ kind: "intake", date: last, field: "kcal", value: 2100, at: AT }];
  await fakeServer(page, { rows, changes });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
}

// A Réglages row found by the start of its visible label, whatever its section says.
async function choose(page: Page, label: RegExp, option: string) {
  await page.goto("/settings");
  await page.getByRole("combobox").filter({ hasText: label }).tap();
  await page.getByRole("option", { name: option }).tap();
  await expect(page.getByRole("combobox").filter({ hasText: label })).toContainText(option);
}

const weeks = (page: Page) => page.getByRole("region", { name: "Your weeks" });

test("chosen in Settings, the in-range pill leaves Accueil and Corps", async ({ page }) => {
  await openHome(page);
  const card = page.getByRole("link", { name: /^7-day average/ });
  await expect(card).toContainText("in your range");
  await choose(page, /^Range/, "Hidden");
  await page.getByRole("link", { name: "Home" }).first().tap();
  await expect(card).toContainText("loss 0.7%/wk last week");
  await expect(card).not.toContainText("in your range");
  await card.tap();
  await expect(page).toHaveURL(/\/body$/);
  await expect(weeks(page).getByRole("listitem").nth(1)).toContainText("0.7%");
  await expect(page.getByText("in your range")).toHaveCount(0);
});

test("chosen in Settings, weekly intake leaves the weeks and stays in the history", async ({
  page,
}) => {
  await openHome(page);
  await page.goto("/body");
  await expect(weeks(page)).toContainText("2,100 kcal");
  await choose(page, /^Intake/, "Hidden");
  await page.goto("/body");
  await expect(weeks(page).getByRole("listitem").nth(1)).toContainText("80.2");
  await expect(weeks(page)).not.toContainText("kcal");
  await expect(page.getByRole("region", { name: "History" })).toContainText("2,100 kcal");
});
