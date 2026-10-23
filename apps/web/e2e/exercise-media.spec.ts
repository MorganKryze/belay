import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock throughout: a loop's state is read while it runs.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const BENCH = "/exercises/ds:0025";
const loop = (page: Page) => page.getByRole("figure", { name: "Demonstration" });
const bodyMap = (page: Page) => page.getByRole("img", { name: /^Body map/ });

async function open(page: Page, path = BENCH) {
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  await expect(bodyMap(page)).toBeVisible();
  // The steps load on their own: the page is whole once they are listed.
  await expect(page.getByRole("main").locator("ol li").first()).toBeVisible();
}

// The video as the browser runs it, not as its attributes describe it.
const media = (video: Locator) =>
  video.evaluate((v: HTMLVideoElement) => ({
    paused: v.paused,
    muted: v.muted,
    controls: v.controls,
    readyState: v.readyState,
    src: new URL(v.currentSrc).pathname,
  }));

const box = async (locator: Locator) => (await locator.boundingBox())!;

test("the loop plays above the body map", async ({ page }) => {
  await fakeServer(page, { media: true });
  await open(page);
  const video = loop(page).locator("video");
  await expect(loop(page)).toBeVisible();
  await expect.poll(async () => (await media(video)).paused).toBe(false);
  const state = await media(video);
  expect(state.muted).toBe(true);
  expect(state.controls).toBe(false);
  expect(state.readyState).toBeGreaterThanOrEqual(2);
  expect(state.src).toBe("/media/exercises/0025");
  const v = await box(video);
  const map = await box(bodyMap(page));
  expect(v.y + v.height).toBeLessThanOrEqual(map.y);
  expect(Math.abs(v.width - v.height)).toBeLessThanOrEqual(1);
  // The card takes the column's width on a phone.
  const column = await box(page.getByRole("main"));
  expect(Math.abs(v.width - column.width)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("with reduced motion the loop waits on its first frame and Play starts it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fakeServer(page, { media: true });
  await open(page);
  const video = loop(page).locator("video");
  await expect(loop(page)).toBeVisible();
  await expect.poll(async () => (await media(video)).readyState).toBeGreaterThanOrEqual(2);
  // Still on its first frame, a beat later.
  await page.waitForTimeout(300);
  expect((await media(video)).paused).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(0.1);
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => (await media(video)).paused).toBe(false);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
});

test("Pause stops it", async ({ page }) => {
  await fakeServer(page, { media: true });
  await open(page);
  const video = loop(page).locator("video");
  await expect.poll(async () => (await media(video)).paused).toBe(false);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect.poll(async () => (await media(video)).paused).toBe(true);
  const play = page.getByRole("button", { name: "Play" });
  await expect(play).toBeVisible();
  // The press springs back before the button is measured.
  await settled(page);
  const b = await box(play);
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);
  // Inside the card, in its bottom-right corner.
  const v = await box(video);
  expect(b.x + b.width).toBeLessThanOrEqual(v.x + v.width);
  expect(b.y + b.height).toBeLessThanOrEqual(v.y + v.height);
  expect(b.x).toBeGreaterThan(v.x + v.width / 2);
  expect(b.y).toBeGreaterThan(v.y + v.height / 2);
});

test("no loop, no box, no text: media off, a belay: exercise, a missing loop", async ({
  page,
  context,
}) => {
  // The same page without media, for its text.
  await fakeServer(page);
  await open(page);
  const plain = await page.getByRole("main").innerText();
  await expect(page.locator("video")).toHaveCount(0);

  const other = await context.newPage();
  await fakeServer(other, { media: true, missingLoops: ["0025"] });
  await open(other, "/exercises/belay:barbell-hip-thrust");
  await expect(other.locator("video, figure[aria-label]")).toHaveCount(0);

  const missing = other.waitForResponse((r) => r.url().endsWith("/media/exercises/0025"));
  await open(other);
  expect((await missing).status()).toBe(404);
  await expect(other.locator("video, figure[aria-label]")).toHaveCount(0);
  expect(await other.getByRole("main").innerText()).toBe(plain);
});

test("offline, a loop seen before plays and one never seen shows nothing", async ({
  page,
  context,
}) => {
  const server = await fakeServer(page, { media: true });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await open(page);
  const video = loop(page).locator("video");
  await expect.poll(async () => (await media(video)).readyState).toBeGreaterThanOrEqual(2);
  await expect
    .poll(() =>
      page.evaluate(
        async () => !!(await (await caches.open("belay-media")).match("/media/exercises/0025")),
      ),
    )
    .toBe(true);

  server.offline = true;
  await context.setOffline(true);
  await open(page);
  await expect(loop(page)).toBeVisible();
  await expect.poll(async () => (await media(video)).readyState).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => (await media(video)).paused).toBe(false);

  await open(page, "/exercises/ds:0043");
  await expect(page.locator("video, figure[aria-label]")).toHaveCount(0);
});

test("nothing scrolls sideways at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await fakeServer(page, { media: true });
  await open(page);
  await expect(loop(page)).toBeVisible();
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  const v = await box(loop(page).locator("video"));
  expect(v.x).toBeGreaterThanOrEqual(0);
  expect(v.x + v.width).toBeLessThanOrEqual(360);
});

test("on a wide screen the loop stays 360 px, above the body map", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fakeServer(page, { media: true });
  await open(page);
  await expect(loop(page)).toBeVisible();
  const v = await box(loop(page).locator("video"));
  expect(Math.round(v.width)).toBe(360);
  expect(Math.abs(v.width - v.height)).toBeLessThanOrEqual(1);
  expect(v.y + v.height).toBeLessThanOrEqual((await box(bodyMap(page))).y);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the exercise sheet with its loop has no axe violation, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await fakeServer(page, { media: true });
    await open(page);
    await expect(loop(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
