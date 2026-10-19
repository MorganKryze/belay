import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";
import { readMotion, recordMotion } from "./motion";
import { settled } from "./settle";

// The real clock throughout: the push, the cover and the session time are read as they run.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const NAV = "cubic-bezier(0.32, 0.72, 0, 1)";
const SHEET = "cubic-bezier(0.4, 0.2, 0, 1)";
const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const NEW = "::view-transition-new(root)";
const OLD = "::view-transition-old(root)";

const PREVIEW = /\/workouts\/session\/A\?from=home$/;
// Accueil's card for session A, then its link to the preview.
const row = (page: Page) =>
  page
    .getByRole("region", { name: /^Session A · Push/ })
    .getByRole("link", { name: "See the session" });
const start = (page: Page) => page.getByRole("link", { name: "Start the session" });

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(row(page)).toBeVisible();
}

async function openPreview(page: Page) {
  await openHome(page);
  await row(page).click();
  await expect(page).toHaveURL(PREVIEW);
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
}

const motionOf = async (page: Page, target: string) =>
  (await readMotion(page)).filter((m) => m.target === target);

test("Accueil's session card pushes the preview and starts nothing", async ({ page }) => {
  const server = await fakeServer(page);
  await recordMotion(page);
  await openPreview(page);
  await expect
    .poll(() => motionOf(page, NEW))
    .toContainEqual(expect.objectContaining({ duration: 420, easing: NAV, transforms: true }));
  await expect
    .poll(() => motionOf(page, OLD))
    .toContainEqual(expect.objectContaining({ duration: 420, easing: NAV, transforms: true }));
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }),
  ).toHaveAttribute("aria-current", "page");
  await expect(start(page)).toBeVisible();
  expect(server.requests.flatMap((r) => r.changes).filter((c) => c.kind === "workout")).toEqual([]);
});

test("Start the session raises the cover from 0:00 and lowering it later lands on Accueil", async ({
  page,
}) => {
  await fakeServer(page);
  await recordMotion(page);
  await openPreview(page);
  await start(page).click();
  await expect(page).toHaveURL(/\/workout$/);
  await expect
    .poll(() => motionOf(page, NEW))
    .toContainEqual(expect.objectContaining({ duration: 450, easing: SHEET, transforms: true }));
  await expect(page.getByText("Elapsed time").locator("..")).toHaveText(/^Elapsed time0:0[01]$/);
  // The preview's entry was replaced: the session sits where the preview was.
  expect(await page.evaluate(() => (history.state as { __TSR_index: number }).__TSR_index)).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("region", { name: /^Session A · Push/ })).toContainText(
    "In progress",
  );
});

test("back from an exercise opened in the preview returns to the preview where it was left", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 460 });
  await fakeServer(page);
  await openPreview(page);
  const url = page.url();
  // The push has played out before the page is scrolled.
  await settled(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, 200);
        return window.scrollY;
      }),
    )
    .toBe(200);
  const third = page
    .getByRole("region", { name: "Exercises" })
    .getByRole("link", { name: /^Sled 45° leg press/ });
  await third.click();
  await expect(page.getByRole("heading", { level: 1, name: "Sled 45° leg press" })).toBeVisible();
  const back = page.getByRole("main").getByRole("link", { name: "Session A", exact: true });
  await expect(back).toHaveAttribute("href", "/workouts/session/A?from=home");
  await back.click();
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  expect(page.url()).toBe(url);
  await expect
    .poll(() => page.evaluate(() => Math.abs(window.scrollY - 200)))
    .toBeLessThanOrEqual(2);
});

async function openProgram(page: Page) {
  await page.goto("/workouts?tab=program");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("region", { name: "Session A · Push" })).toBeVisible();
}

test("the Programme's next card pushes the preview, and back says Programme", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 460 });
  await fakeServer(page);
  await recordMotion(page);
  await openProgram(page);
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, 80);
        return window.scrollY;
      }),
    )
    .toBe(80);
  const see = page
    .getByRole("region", { name: "Session A · Push" })
    .getByRole("link", { name: "See the session" });
  await see.click();
  await expect(page).toHaveURL(/\/workouts\/session\/A$/);
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  await expect
    .poll(() => motionOf(page, NEW))
    .toContainEqual(expect.objectContaining({ duration: 420, easing: NAV, transforms: true }));
  await expect
    .poll(() => motionOf(page, OLD))
    .toContainEqual(expect.objectContaining({ duration: 420, easing: NAV, transforms: true }));
  const back = page.getByRole("main").getByRole("link", { name: "Program", exact: true });
  await expect(back).toHaveAttribute("href", "/workouts?tab=program");
  await back.click();
  await expect(page).toHaveURL(/\/workouts\?tab=program$/);
  await expect
    .poll(() => motionOf(page, NEW))
    .toContainEqual(expect.objectContaining({ duration: 380, easing: NAV, transforms: true }));
  await expect
    .poll(() => motionOf(page, OLD))
    .toContainEqual(expect.objectContaining({ duration: 380, easing: NAV, transforms: true }));
  await expect(page.getByRole("radio", { name: "Program" })).toHaveAttribute(
    "data-state",
    "checked",
  );
  await expect(page.getByRole("region", { name: "Session A · Push" })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Math.abs(window.scrollY - 80)))
    .toBeLessThanOrEqual(2);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sessions" }),
  ).toHaveAttribute("aria-current", "page");
});

test("a tap on another card opens its preview", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("belay.theme", "light"));
  await fakeServer(page);
  await recordMotion(page);
  await openProgram(page);
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const b = page.getByRole("link", { name: /^Session B · Legs/ });
  await expect(b).toHaveAttribute("href", "/workouts/session/B");
  await b.getByText(/Never done/).click();
  await expect(page).toHaveURL(/\/workouts\/session\/B$/);
  await expect(page.getByRole("heading", { level: 1, name: "Session B · Legs" })).toBeVisible();
  await expect
    .poll(() => motionOf(page, NEW))
    .toContainEqual(expect.objectContaining({ duration: 420, easing: NAV, transforms: true }));
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sessions" }),
  ).toHaveAttribute("aria-current", "page");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion the preview slides in 300 ms and the page left holds still", async ({
    page,
  }) => {
    await fakeServer(page);
    await recordMotion(page);
    await openPreview(page);
    await expect
      .poll(() => motionOf(page, NEW))
      .toContainEqual(expect.objectContaining({ duration: 300, easing: OUT, transforms: true }));
    // Neither moved nor dimmed: the page left behind runs no animation at all.
    expect(await motionOf(page, OLD)).toEqual([]);
  });
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`the session preview has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page);
      await openPreview(page);
      await expect(page.getByRole("region", { name: "Exercises" })).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
});
