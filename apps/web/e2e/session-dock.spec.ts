import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";
import { readMotion, recordMotion } from "./motion";

// The real clock throughout: the rest is counted from its stored end while the session is lowered.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const SHEET = "cubic-bezier(0.4, 0.2, 0, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";

// Session A three days ago, the bench press at 80 kg × 8: the first set comes prefilled.
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
const minimize = (page: Page) => page.getByRole("button", { name: "Minimize the session" });
const bar = (page: Page) => page.getByRole("link", { name: /Rest · set 2 of 4 · Session A/ });
const seconds = async (timer: Locator) => {
  const [m, s] = (await timer.textContent())!.split(":").map(Number);
  return m! * 60 + s!;
};
const motion = async (page: Page, target: (t: string) => boolean) =>
  (await readMotion(page)).filter((m) => target(m.target));
const isBar = (t: string) => t.startsWith("a");

// Session A started on this device, its first set logged: the rest runs.
async function rest(page: Page) {
  await fakeServer(page, { changes: LAST_A });
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  const load = bench(page).getByRole("textbox", { name: "Load of set 1, kg" });
  await expect(load).toHaveValue("80");
  await expect(bench(page).getByRole("textbox", { name: "Reps of set 1" })).toHaveValue("8");
  await bench(page).getByRole("button", { name: "Log set 1" }).click();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
}

async function lower(page: Page) {
  await minimize(page).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(bar(page)).toBeVisible();
}

async function openPlates(page: Page) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tools" }).click();
  await page.getByRole("link", { name: /^Plates/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Plates" })).toBeVisible();
}

// The bar's rise keyframes, read off the element: the recorder keeps no values.
const riseFrom = (link: Locator) =>
  link.evaluate((el) =>
    el
      .getAnimations()
      .map((a) => (a.effect as KeyframeEffect).getKeyframes()[0]?.transform ?? null)
      .at(0),
  );

test("the session header stays at the top while the cards scroll, each control 44 px", async ({
  page,
}) => {
  await rest(page);
  const time = page.getByText("Elapsed time").locator("..");
  const finish = page.getByRole("button", { name: "Finish" });
  const header = minimize(page).locator("..");
  for (const target of [minimize(page), time, finish]) {
    const box = (await target.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect((await header.boundingBox())!.height).toBe(52);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await expect.poll(async () => (await header.boundingBox())!.y).toBe(0);
  const title = page.getByRole("heading", { level: 1, name: "Session A · Push" });
  expect((await title.boundingBox())!.y).toBeLessThan(0);
});

test("Minimize lowers the session onto Accueil and the bar counts the rest down", async ({
  page,
}) => {
  await recordMotion(page);
  await rest(page);
  await lower(page);
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  await expect
    .poll(() => motion(page, (t) => t === "::view-transition-old(root)"))
    .toContainEqual(expect.objectContaining({ duration: 260, easing: EXIT, transforms: true }));
  await expect
    .poll(() => motion(page, isBar))
    .toContainEqual(
      expect.objectContaining({
        duration: 220,
        easing: OUT,
        transforms: true,
        properties: ["opacity", "transform"],
      }),
    );
  await expect.poll(() => riseFrom(bar(page))).toBe("translateY(8px)");
  const timer = bar(page).getByRole("timer");
  const before = await seconds(timer);
  expect(before).toBeGreaterThan(100);
  await page.waitForTimeout(1200);
  expect(await seconds(timer)).toBeLessThan(before);
});

test("Outils › Plates works while the session is lowered, and the bar raises it at the same set", async ({
  page,
}) => {
  await recordMotion(page);
  await rest(page);
  await lower(page);
  await openPlates(page);
  const target = page.getByRole("textbox", { name: "Target load" });
  await expect(target).toHaveValue("100");
  await target.fill("80");
  await target.blur();
  await expect(page.getByRole("region", { name: "On each side" })).toContainText(
    "20 + 10 kg per side",
  );
  const before = await seconds(bar(page).getByRole("timer"));
  await bar(page).hover();
  await page.mouse.down();
  expect(await bar(page).evaluate((el) => getComputedStyle(el).transform)).toBe(
    "matrix(0.97, 0, 0, 0.97, 0, 0)",
  );
  await page.mouse.up();
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  await expect
    .poll(() => motion(page, (t) => t === "::view-transition-new(root)"))
    .toContainEqual(expect.objectContaining({ duration: 450, easing: SHEET, transforms: true }));
  await expect
    .poll(() => motion(page, (t) => t === "::view-transition-old(dock)"))
    .toContainEqual(
      expect.objectContaining({ duration: 140, easing: EXIT, properties: ["opacity"] }),
    );
  await expect(bench(page).getByRole("button", { name: "Log set 2" })).toBeVisible();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await expect.poll(() => seconds(page.getByRole("timer"))).toBeLessThan(before);
  expect(await seconds(page.getByRole("timer"))).toBeGreaterThan(before - 10);
});

test("a reload on a tab keeps the bar's countdown", async ({ page }) => {
  await rest(page);
  await lower(page);
  await openPlates(page);
  const before = await seconds(bar(page).getByRole("timer"));
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Plates" })).toBeVisible();
  await expect(bar(page)).toBeVisible();
  const after = await seconds(bar(page).getByRole("timer"));
  expect(Math.abs(before - after)).toBeLessThanOrEqual(2);
});

test("on a computer Minimize returns to the page under the session and no bar shows", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await fakeServer(page, { changes: LAST_A });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await page
    .getByRole("region", { name: /^Session B · Legs/ })
    .getByRole("link", { name: "See the session" })
    .click();
  await page.getByRole("link", { name: "Start the session" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Session B · Legs" })).toBeVisible();
  await minimize(page).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  // Back to the entry under the session, not a new one.
  expect(await page.evaluate(() => (history.state as { __TSR_index: number }).__TSR_index)).toBe(0);
  await expect(page.getByRole("region", { name: /^Session B · Legs/ })).toContainText(
    "In progress",
  );
  await expect(page.getByRole("link", { name: /In progress · .*Session B/ })).toBeHidden();
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion the cover slides in 300 ms, the bar and the tabs fade in 200 ms and nothing scales", async ({
    page,
  }) => {
    await recordMotion(page);
    await rest(page);
    await lower(page);
    await expect
      .poll(() => motion(page, isBar))
      .toContainEqual(
        expect.objectContaining({
          duration: 200,
          easing: OUT,
          transforms: false,
          properties: ["opacity"],
        }),
      );
    await bar(page).hover();
    await page.mouse.down();
    expect(await bar(page).evaluate((el) => getComputedStyle(el).transform)).not.toContain("0.97");
    await page.mouse.up();
    await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
    await expect
      .poll(() => motion(page, (t) => t === "::view-transition-new(root)"))
      .toContainEqual(expect.objectContaining({ duration: 300, easing: OUT, transforms: true }));
    await expect
      .poll(() => motion(page, (t) => t === "::view-transition-new(dock)"))
      .toContainEqual(
        expect.objectContaining({ duration: 200, easing: OUT, properties: ["opacity"] }),
      );
    expect((await readMotion(page)).filter((m) => m.scales)).toEqual([]);
  });
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`the lowered session has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await rest(page);
      await lower(page);
      await openPlates(page);
      await expect(bar(page).getByRole("timer")).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
});
