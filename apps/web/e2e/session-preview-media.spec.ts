import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock throughout: the first frames load as they would on a phone.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const PREVIEW = "/workouts/session/A";
const list = (page: Page) => page.getByRole("region", { name: "Exercises" });
const rows = (page: Page) => list(page).getByRole("link");

async function open(page: Page) {
  await page.goto(PREVIEW);
  await expect(page.locator(".launch")).toBeHidden();
  await expect(rows(page)).toHaveCount(6);
}

// Every thumbnail of the list, as the browser runs it.
const videos = (page: Page) =>
  list(page)
    .locator("video")
    .evaluateAll((all: HTMLVideoElement[]) =>
      all.map((v) => ({ paused: v.paused, readyState: v.readyState, hidden: v.hidden })),
    );

async function framesReady(page: Page) {
  await expect
    .poll(async () => (await videos(page)).filter((v) => v.readyState >= 2 && !v.hidden).length)
    .toBe(6);
}

const shape = (page: Page) =>
  rows(page).evaluateAll((all: HTMLElement[]) =>
    all.map((a) => ({ height: a.getBoundingClientRect().height, text: a.innerText })),
  );

test("rows keep 56 px and their names with thumbnails", async ({ page, context }) => {
  await fakeServer(page);
  await open(page);
  const plain = await shape(page);

  const other = await context.newPage();
  await fakeServer(other, { media: true });
  await open(other);
  await framesReady(other);
  const thumbs = await shape(other);
  for (const row of thumbs) expect(Math.round(row.height)).toBe(56);
  // The names and lines read the same; only the numbers gave way to the frames.
  expect(thumbs.map((r) => r.text.replace(/^\d+\s*/, ""))).toEqual(
    plain.map((r) => r.text.replace(/^\d+\s*/, "")),
  );
  const box = (await other.locator("ul video").first().boundingBox())!;
  expect(Math.round(box.width)).toBe(44);
  expect(Math.round(box.height)).toBe(44);
});

test("no video plays", async ({ page }) => {
  await fakeServer(page, { media: true });
  await open(page);
  await framesReady(page);
  await page.waitForTimeout(300);
  const all = await videos(page);
  expect(all).toHaveLength(6);
  expect(all.every((v) => v.paused)).toBe(true);
});

test("media off: the rows are as today", async ({ page }) => {
  await fakeServer(page);
  await open(page);
  await expect(page.locator("video")).toHaveCount(0);
  const tile = list(page).getByText("1", { exact: true });
  const box = (await tile.boundingBox())!;
  expect(Math.round(box.width)).toBe(28);
  for (const row of await shape(page)) expect(Math.round(row.height)).toBe(56);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the preview with thumbnails has no axe violation, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await fakeServer(page, { media: true });
    await open(page);
    await framesReady(page);
    await expectNoAxeViolations(page);
  });
}

test("opening the preview puts its loops in the offline cache", async ({ page }) => {
  await fakeServer(page, { media: true });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await open(page);
  await framesReady(page);
  await expect
    .poll(() => page.evaluate(async () => (await (await caches.open("belay-media")).keys()).length))
    .toBe(6);
});
