import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

// Short enough that the tools list scrolls well past 60 px.
const scrollsFar = (page: Page) => page.setViewportSize({ width: 390, height: 500 });

// Measured once the fonts are in, so a late font never reads as the title changing size.
const state = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    const h1 = document.querySelector("main h1")!;
    const compact = document.querySelector("[data-compact-title]")!;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    };
    return {
      large: Number(getComputedStyle(h1).opacity),
      compact: Number(getComputedStyle(compact).opacity),
      fill: Number(getComputedStyle(compact.parentElement!.previousElementSibling!).opacity),
      boxes: [box(h1), box(compact)],
    };
  });

// Measured once the fonts are in, as they change the page's height.
const scrollRange = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    return document.documentElement.scrollHeight - window.innerHeight;
  });

const scrollTo = async (page: Page, y: number) => {
  await page.evaluate((top) => window.scrollTo(0, top), y);
  await page.evaluate(() => new Promise(requestAnimationFrame));
  await page.evaluate(() => new Promise(requestAnimationFrame));
};

test("the large title folds into the frosted compact header over 44 px of scroll without changing size", async ({
  page,
}) => {
  await scrollsFar(page);
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  const top = await state(page);
  expect([top.large, top.compact, top.fill]).toEqual([1, 0, 0]);
  await scrollTo(page, 60);
  const folded = await state(page);
  expect([folded.large, folded.compact, folded.fill]).toEqual([0, 1, 1]);
  expect(folded.boxes).toEqual(top.boxes);
});

test("with reduced motion the compact header shows from the start and the large title scrolls without fading", async ({
  page,
}) => {
  await scrollsFar(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  const top = await state(page);
  expect([top.large, top.compact, top.fill]).toEqual([1, 1, 1]);
  await scrollTo(page, 60);
  const scrolled = await state(page);
  expect([scrolled.large, scrolled.compact, scrolled.fill]).toEqual([1, 1, 1]);
});

test("a page that does not scroll shows only the large title under a clear bar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Belay" })).toBeVisible();
  expect(await scrollRange(page)).toBe(0);
  const top = await state(page);
  expect([top.large, top.compact, top.fill]).toEqual([1, 0, 0]);
});

test("a page that scrolls less than 44 px still folds all the way at its bottom", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  const range = await scrollRange(page);
  expect(range).toBeGreaterThan(0);
  expect(range).toBeLessThan(44);
  const top = await state(page);
  expect([top.large, top.compact, top.fill]).toEqual([1, 0, 0]);
  // Past the end: the browser stops at the bottom, wherever late content puts it.
  await scrollTo(page, 1000);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(44);
  const bottom = await state(page);
  expect([bottom.large, bottom.compact, bottom.fill]).toEqual([0, 1, 1]);
});

test("on a tab screen the offline banner keeps its top padding above the header", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Belay" })).toBeVisible();
  await context.setOffline(true);
  const banner = page.getByText("You're offline.", { exact: true });
  await expect(banner).toBeVisible();
  // Measured where the banner settles, after it drops in.
  await banner.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const box = (await banner.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(16);
  const title = (await page.getByRole("heading", { level: 1 }).boundingBox())!;
  expect(title.y).toBeGreaterThan(box.y + box.height);
});

// Long English names fill the bar: the compact title must truncate before the back label, centred.
for (const id of ["ds:0025", "ds:0405", "ds:0410"]) {
  test(`on ${id} the scrolled compact title stays centred and clear of the back label at 360 px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 500 });
    await page.goto(`/exercises/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await scrollTo(page, 60);
    const { back, title } = await page.evaluate(async () => {
      await document.fonts.ready;
      const box = (el: Element) => el.getBoundingClientRect().toJSON() as DOMRect;
      return {
        back: box(document.querySelector("main a[href^='/workouts']")!),
        title: box(document.querySelector("[data-compact-title]")!),
      };
    });
    expect(title.left - back.right).toBeGreaterThanOrEqual(8);
    expect(Math.abs(title.left + title.width / 2 - 180)).toBeLessThanOrEqual(1);
  });
}
