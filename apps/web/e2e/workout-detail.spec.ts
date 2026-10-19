import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// Wednesday 7 October 2026, 6 p.m. in Paris; only static checks here, so the clock stands still.
const NOW = new Date("2026-10-07T18:00:00+02:00");
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await fakeServer(page, { changes: PAST });
});

const A = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const C = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f02";
// A finished session `code`, its first exercise done `sets` times at 80 kg × 8.
function finished(
  workout: string,
  code: string,
  start: string,
  end: string,
  sets: number,
): Change[] {
  const plan = [...sessionByCode(code)!.slots];
  return [
    {
      kind: "workout",
      id: workout,
      field: "start",
      sessionCode: code,
      plan,
      startedAt: start,
      at: start,
    },
    ...Array.from({ length: sets }, (_, k): Change => ({
      kind: "set",
      id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c8${code.toLowerCase()}${String(10 + k)}`,
      workoutId: workout,
      field: "create",
      slotIndex: 0,
      position: 3 + k,
      exerciseId: plan[0]!.exerciseId,
      warmup: false,
      weightKg: 80,
      reps: 8,
      rir: 1,
      doneAt: start,
      at: start,
    })),
    { kind: "workout", id: workout, field: "ended", value: end, at: end },
  ];
}
// Session A on Monday, and session C, the longest title, on Tuesday.
const PAST: Change[] = [
  ...finished(A, "A", "2026-10-05T16:00:00.000Z", "2026-10-05T17:04:00.000Z", 12),
  ...finished(C, "C", "2026-10-06T16:00:00.000Z", "2026-10-06T17:10:00.000Z", 12),
];

async function open(page: Page, workout: string, title: string) {
  await page.goto(`/workouts/${workout}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
}

const back = (page: Page) => page.locator("main").getByRole("link", { name: "History" });
const edit = (page: Page) => page.locator("main").getByRole("link", { name: "Edit" });
const compact = (page: Page) => page.locator("[data-compact-title]");

test("Edit sits at the right end of the top bar, at least 44 × 44, in the back link's ink", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, A, "Session A · Push");
  const box = (await edit(page).boundingBox())!;
  const bar = (await compact(page).locator("xpath=../..").boundingBox())!;
  expect(390 - (box.x + box.width)).toBeLessThanOrEqual(12);
  expect(box.y).toBeGreaterThanOrEqual(bar.y);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 0.5);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const color = (el: Element) => getComputedStyle(el).color;
  expect(await edit(page).evaluate(color)).toBe(await back(page).evaluate(color));
});

const foldBy200 = async (page: Page) => {
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
};

test("the compact title stays centred between History and Edit once folded", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await open(page, A, "Session A · Push");
  await foldBy200(page);
  await expect(compact(page)).toHaveCSS("opacity", "1");
  const title = (await compact(page).boundingBox())!;
  const middle = await page.evaluate(() => document.documentElement.clientWidth / 2);
  expect(Math.abs(title.x + title.width / 2 - middle)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 360, height: 480 });
  await open(page, C, "Session C · Glutes + light pull");
  await foldBy200(page);
  const long = (await compact(page).boundingBox())!;
  const left = (await back(page).boundingBox())!;
  const right = (await edit(page).boundingBox())!;
  expect(long.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(long.x + long.width).toBeLessThanOrEqual(right.x);
});

test("the past session has nothing scrolling sideways at 360, 390 and 1 280 px", async ({
  page,
}) => {
  for (const [width, height] of [
    [360, 740],
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page, C, "Session C · Glutes + light pull");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  }
});
