import type { Change } from "@belay/shared/sync/schema";
import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer } from "./fake-server";
import { asAndroid } from "./native";

// Android's Back as the app sends it: one call to the page per press, whose answer tells the app
// whether to step aside.
test.use({ locale: "fr-FR" });

test.beforeEach(async ({ page, baseURL }) => {
  await asAndroid(page, { instance: baseURL!, token: "a".repeat(43) });
});

async function open(page: Page, path: string, changes: Change[] = []) {
  await fakeServer(page, { changes });
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
}

// One press of the system Back, once the page has installed its answer.
async function back(page: Page) {
  await expect.poll(() => page.evaluate(() => typeof window.belayBack)).toBe("function");
  return page.evaluate(() => window.belayBack?.());
}

const entries = (page: Page) => page.evaluate(() => history.length);
const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Principale" }).getByRole("link", { name });

test("Back closes the weigh-in sheet over Accueil, the page and its history unchanged, focus back on its row", async ({
  page,
}) => {
  await open(page, "/");
  const row = page.getByRole("button", { name: /^Pesée/ });
  await row.click();
  const sheet = page.getByRole("dialog", { name: "Pesée" });
  await expect(sheet).toBeVisible();
  await settled(page);
  const url = page.url();
  const length = await entries(page);
  expect(await back(page)).toBe("surface");
  await expect(sheet).toBeHidden();
  expect(page.url()).toBe(url);
  expect(await entries(page)).toBe(length);
  await expect(row).toBeFocused();
});

// Five sessions in the program: the rhythm sheet on fixed days picks each day from a menu.
const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const T0 = "2026-09-01T08:00:00.000Z";
const FIVE: Change[] = [
  {
    kind: "program",
    id: id(0x10),
    field: "create",
    name: "Ma semaine",
    schedule: { mode: "rotation", days: Array<null>(7).fill(null) },
    at: T0,
  },
  { kind: "activeProgram", programId: id(0x10), at: T0 },
  ...["ds:0025", "ds:0043", "ds:2330", "ds:0047", "ds:0160"].flatMap((exerciseId, i): Change[] => [
    {
      kind: "programSession",
      id: id(0x11 + i),
      field: "create",
      name: `Jour ${i + 1}`,
      programId: id(0x10),
      position: i,
      at: T0,
    },
    {
      kind: "programSlot",
      id: id(0x100 + i),
      field: "create",
      sessionId: id(0x11 + i),
      position: 0,
      rule: null,
      exerciseId,
      sets: 3,
      repRange: [8, 12],
      rirTarget: [1, 2],
      restSec: 90,
      warmupSets: 0,
      isMain: false,
      groupKey: null,
      at: T0,
    },
  ]),
];

test("a menu open over a sheet takes one press, the sheet the next", async ({ page }) => {
  await open(page, "/workouts?tab=program", FIVE);
  await expect(page.getByRole("button", { name: /^Ma semaine / })).toBeVisible();
  await page.getByRole("button", { name: /^Rythme / }).click();
  const sheet = page.getByRole("dialog", { name: "Rythme du programme" });
  await sheet.getByRole("radio", { name: "Jours fixes" }).click();
  await sheet.getByRole("combobox").first().click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  await settled(page);
  expect(await back(page)).toBe("surface");
  await expect(menu).toBeHidden();
  await expect(sheet).toBeVisible();
  await settled(page);
  expect(await back(page)).toBe("surface");
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/workouts\?tab=program$/);
});

test("Back lowers the session cover as its own control does, and the session bar shows", async ({
  page,
}) => {
  await open(page, "/workout?start=A");
  await expect(page.getByRole("button", { name: "Réduire la séance" })).toBeVisible();
  expect(await back(page)).toBe("cover");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("region", { name: "Séance en cours" })).toBeVisible();
});

test("Back from a pushed page shows the page before it", async ({ page }) => {
  await open(page, "/");
  await page.getByRole("link", { name: "Réglages" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
  expect(await back(page)).toBe("page");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: /^Bonjour/ })).toBeVisible();
});

test("Back from Outils shows Accueil", async ({ page }) => {
  await open(page, "/");
  await tab(page, "Outils").click();
  await expect(page.getByRole("heading", { level: 1, name: "Outils" })).toBeVisible();
  expect(await back(page)).toBe("tab-root");
  await expect(page).toHaveURL(/\/$/);
  await expect(tab(page, "Accueil")).toHaveAttribute("aria-current", "page");
});

test("on Accueil Back leaves the page as it is and tells the app to step aside", async ({
  page,
}) => {
  await open(page, "/");
  const length = await entries(page);
  expect(await back(page)).toBe("home");
  await expect(page).toHaveURL(/\/$/);
  expect(await entries(page)).toBe(length);
});
