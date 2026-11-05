import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer } from "./fake-server";
import { asIPhone, swipeCalls } from "./native";

// The iPhone's edge swipe as the page drives it: the web view's own back gesture, on only while a
// pushed page is on top. The shell starts with it off, so no call means off.
test.use({ locale: "fr-FR" });

test.beforeEach(async ({ page, baseURL }) => {
  await asIPhone(page, { instance: baseURL!, token: "a".repeat(43) });
  await fakeServer(page);
});

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
}

// The swipe as the shell holds it: the last state the page asked for, off when it asked none.
const swipe = async (page: Page) => (await swipeCalls(page)).at(-1) ?? false;

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Principale" }).getByRole("link", { name });

// Every record of every store of every database the app keeps on this device.
const stored = (page: Page) =>
  page.evaluate(async () => {
    const dump: Record<string, Record<string, unknown[]>> = {};
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      dump[name] = {};
      for (const store of db.objectStoreNames) {
        dump[name][store] = await new Promise<unknown[]>((resolve, reject) => {
          const all = db.transaction(store).objectStore(store).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => reject(all.error);
        });
      }
      db.close();
    }
    return dump;
  });

test("the swipe is off at start and on the tab roots, on at a pushed page", async ({ page }) => {
  await open(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: /^Bonjour/ })).toBeVisible();
  expect(await swipeCalls(page)).toEqual([]);
  await tab(page, "Outils").click();
  await expect(page.getByRole("heading", { level: 1, name: "Outils" })).toBeVisible();
  expect(await swipe(page)).toBe(false);
  await page.locator("a[href='/tools/bmi']").click();
  await expect(page).toHaveURL(/\/tools\/bmi$/);
  await expect.poll(() => swipe(page)).toBe(true);
  await tab(page, "Corps").click();
  await expect.poll(() => swipe(page)).toBe(false);
});

test("a sheet open over a pushed page turns the swipe off until it closes", async ({ page }) => {
  await open(page, "/settings");
  await expect.poll(() => swipe(page)).toBe(true);
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  const sheet = page.getByRole("dialog", { name: /^Se déconnecter/ });
  await expect(sheet).toBeVisible();
  await expect.poll(() => swipe(page)).toBe(false);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect.poll(() => swipe(page)).toBe(true);
});

test("the session cover keeps the swipe off", async ({ page }) => {
  await open(page, "/workout?start=A");
  await expect(page.getByRole("button", { name: "Réduire la séance" })).toBeVisible();
  await settled(page);
  expect(await swipeCalls(page)).toEqual([]);
});

// The web view's swipe comes with a forward one from the right edge, which the shell cannot
// remove alone: landing on the page left must show it and do nothing else.
test("forward again to a page left shows it and starts, writes and opens nothing", async ({
  page,
}) => {
  await open(page, "/");
  await page.getByRole("link", { name: "Réglages" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: /^Bonjour/ })).toBeVisible();
  await settled(page);
  const before = await stored(page);
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
  await expect.poll(() => swipe(page)).toBe(true);
  await settled(page);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("region", { name: "Séance en cours" })).toHaveCount(0);
  await expect(page.locator("[role=dialog],[role=alertdialog]")).toHaveCount(0);
  expect(await stored(page)).toEqual(before);
});
