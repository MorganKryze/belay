import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { devices, expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock throughout: a loop's state is read while it runs.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// Session A three days ago, the bench press at 80 kg × 8, 8, 7, 6: every set comes prefilled.
const DAY = new Date(Date.now() - 3 * 86_400_000);
const at = (minutes: number) => new Date(DAY.getTime() + minutes * 60_000).toISOString();
const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: at(0),
    at: at(0),
  },
  ...[8, 8, 7, 6].map((reps, k): Change => ({
    kind: "set",
    id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e1${k}`,
    workoutId: LAST,
    field: "create",
    slotIndex: 0,
    position: 3 + k,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg: 80,
    reps,
    rir: 1,
    doneAt: at(5 + k * 3),
    at: at(5 + k * 3),
  })),
  { kind: "workout", id: LAST, field: "ended", value: at(60), at: at(60) },
];

const bench = (page: Page) => page.getByRole("region", { name: /^Barbell bench press/ });
const load = (page: Page, n: number) =>
  bench(page).getByRole("textbox", { name: `Load of set ${n}, kg` });
const reps = (page: Page, n: number) =>
  bench(page).getByRole("textbox", { name: `Reps of set ${n}` });
const show = (card: Locator) => card.getByRole("button", { name: "Show the movement" });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Barbell bench press" });
const loop = (page: Page) =>
  sheet(page).getByRole("figure", { name: /^Demonstration of Barbell bench press$/ });

// Session A started on this device, its cells prefilled from last time.
async function start(page: Page, media = true, worker = false) {
  const server = await fakeServer(page, { changes: LAST_A, media });
  if (worker) {
    // Loops go through the service worker's cache only once it controls the page.
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  }
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(load(page, 1)).toHaveValue("80");
  await expect(reps(page, 1)).toHaveValue("8");
  return server;
}

// The video as the browser runs it, not as its attributes describe it.
const media = (video: Locator) =>
  video.evaluate((v: HTMLVideoElement) => ({
    paused: v.paused,
    muted: v.muted,
    controls: v.controls,
    readyState: v.readyState,
    currentTime: v.currentTime,
    src: new URL(v.currentSrc).pathname,
  }));

const box = async (locator: Locator) => (await locator.boundingBox())!;

// Every box on the logging path: the set rows' cells and ticks, the RIR choices, the actions.
const pathBoxes = async (page: Page) => {
  await settled(page);
  const card = bench(page);
  const controls = card.locator("input, button:not(:has(video)):not(figure *), [role=radio]");
  const boxes = [];
  for (const el of await controls.all()) boxes.push(await box(el));
  return boxes;
};

test("the still opens the loop in a sheet, which closes back on the still", async ({ page }) => {
  await start(page);
  const card = bench(page);
  await expect(show(card)).toBeVisible();
  await expect(show(card)).toHaveAttribute("aria-haspopup", "dialog");
  await expect(page.locator("figure")).toHaveCount(0);
  const b = await box(show(card));
  expect(b.width).toBeGreaterThanOrEqual(44);
  expect(b.height).toBeGreaterThanOrEqual(44);

  await show(card).click();
  await expect(sheet(page)).toBeVisible();
  // The sheet holds the loop and nothing else: no field, no button but close and pause.
  await expect(sheet(page).getByRole("textbox")).toHaveCount(0);
  await expect(sheet(page).getByRole("button")).toHaveCount(2);
  const video = loop(page).locator("video");
  await expect(loop(page)).toBeVisible();
  await expect.poll(async () => (await media(video)).paused).toBe(false);
  const state = await media(video);
  expect(state.muted).toBe(true);
  expect(state.controls).toBe(false);
  expect(state.src).toBe("/media/exercises/0025");
  // Square, inside the sheet.
  await settled(page);
  const v = await box(video);
  const s = await box(sheet(page));
  expect(Math.abs(v.width - v.height)).toBeLessThanOrEqual(1);
  expect(v.x).toBeGreaterThanOrEqual(s.x);
  expect(v.x + v.width).toBeLessThanOrEqual(s.x + s.width);
  expect(v.y + v.height).toBeLessThanOrEqual(s.y + s.height);

  await sheet(page).getByRole("button", { name: "Pause" }).click();
  await expect.poll(async () => (await media(video)).paused).toBe(true);
  await sheet(page).getByRole("button", { name: "Play the demonstration" }).click();
  await expect.poll(async () => (await media(video)).paused).toBe(false);

  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("figure")).toHaveCount(0);
  await expect(show(card)).toBeFocused();
});

test("with a loop on offer, the set rows sit where they sit without media", async ({
  page,
  browser,
}) => {
  const plainContext = await browser.newContext({
    ...devices["Pixel 7"],
    locale: "en-US",
    timezoneId: "Europe/Paris",
    baseURL: test.info().project.use.baseURL,
  });
  const plain = await plainContext.newPage();
  await start(plain, false);
  await expect(plain.locator("video")).toHaveCount(0);
  const without = await pathBoxes(plain);
  await plainContext.close();

  await start(page);
  await expect(show(bench(page))).toBeVisible();
  const withMedia = await pathBoxes(page);
  expect(withMedia).toHaveLength(without.length);
  withMedia.forEach((b, i) => {
    const a = without[i]!;
    expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.width - a.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(b.height - a.height)).toBeLessThanOrEqual(1);
  });
});

test("a set is still logged in two taps once the loop's sheet is closed", async ({ page }) => {
  await start(page);
  const card = bench(page);
  const before = await pathBoxes(page);
  await show(card).click();
  await expect(loop(page)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The loop opened over the card, not in it: nothing on the logging path moved.
  expect(await pathBoxes(page)).toEqual(before);

  // ✓ on the prefilled values, then the RIR under the next set, as without media.
  await card.getByRole("button", { name: "Log set 1" }).click();
  await expect(card.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  const rir = card.getByRole("radiogroup", { name: "RIR, reps in reserve" });
  await rir.getByRole("radio", { name: "2", exact: true }).click();
  await expect(rir.getByRole("radio", { name: "2", exact: true })).toBeChecked();
});

test("reduced motion: the sheet's loop waits on its first frame", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await start(page);
  const card = bench(page);
  await show(card).click();
  const video = loop(page).locator("video");
  await expect(loop(page)).toBeVisible();
  await expect.poll(async () => (await media(video)).readyState).toBeGreaterThanOrEqual(2);
  // Still on its first frame, a beat later.
  await page.waitForTimeout(300);
  const state = await media(video);
  expect(state.paused).toBe(true);
  expect(state.currentTime).toBeLessThan(0.1);
  // The play control sits in the pause's corner, at the loop's bottom right.
  const play = sheet(page).getByRole("button", { name: "Play the demonstration" });
  await expect(play).toBeVisible();
  const p = await box(play);
  const v = await box(video);
  expect(Math.abs(v.x + v.width - (p.x + p.width))).toBeLessThanOrEqual(12);
  expect(Math.abs(v.y + v.height - (p.y + p.height))).toBeLessThanOrEqual(12);
});

test("offline, an unseen exercise offers no control", async ({ page, context }) => {
  const server = await start(page, true, true);
  // The bench press's still has been drawn: its loop is in the offline cache.
  await expect(show(bench(page))).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        async () => !!(await (await caches.open("belay-media")).match("/media/exercises/0025")),
      ),
    )
    .toBe(true);

  server.offline = true;
  await context.setOffline(true);
  await page.goto("/workout");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(load(page, 1)).toHaveValue("80");
  await expect(show(bench(page))).toBeVisible();

  // The shoulder press was never opened: nothing of its loop was fetched.
  const press = page.getByRole("region", { name: /^Dumbbell seated shoulder press/ });
  await press.getByRole("button", { name: /^Dumbbell seated shoulder press/ }).click();
  await expect(press.getByRole("textbox", { name: "Load of set 1, kg" })).toBeVisible();
  await expect(press.getByRole("button", { name: /movement$/ })).toHaveCount(0);
  await expect(press.locator("video, figure")).toHaveCount(0);
});

test("nothing scrolls sideways at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await start(page);
  await show(bench(page)).click();
  await expect(loop(page)).toBeVisible();
  await settled(page);
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll).toBeLessThanOrEqual(client);
  const v = await box(loop(page).locator("video"));
  expect(v.x).toBeGreaterThanOrEqual(0);
  expect(v.x + v.width).toBeLessThanOrEqual(360);
});

for (const scheme of ["light", "dark"] as const) {
  test(`the loop's sheet over the session has no axe violation, ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await start(page);
    await show(bench(page)).click();
    await expect(loop(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}
