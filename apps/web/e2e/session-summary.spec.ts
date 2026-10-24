import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock: the session ended yesterday, whatever day the run is on.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const DONE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e02";
const start = new Date(Date.now() - 24 * 3_600_000);
const START = start.toISOString();
const END = new Date(start.getTime() + 64 * 60_000).toISOString();
// Five exercises, 11 work sets: an hour and more, so the duration figure is at its widest.
const LOGGED: readonly [number, string, number, number][] = [
  [0, "ds:0025", 82.5, 8],
  [0, "ds:0025", 80, 7],
  [0, "ds:0025", 80, 7],
  [0, "ds:0025", 77.5, 8],
  [1, "ds:0405", 30, 10],
  [1, "ds:0405", 30, 10],
  [1, "ds:0405", 30, 10],
  [2, "ds:0739", 120, 10],
  [2, "ds:0739", 120, 10],
  [3, "ds:0334", 10, 15],
  [5, "ds:0605", 20, 12],
];
const SESSION: Change[] = [
  {
    kind: "workout",
    id: DONE,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt: START,
    at: START,
  },
  ...LOGGED.map(([slotIndex, exerciseId, weightKg, reps], k): Change => ({
    kind: "set",
    id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f${String(k).padStart(2, "0")}`,
    workoutId: DONE,
    field: "create",
    slotIndex,
    position: 3 + k,
    exerciseId,
    warmup: false,
    weightKg,
    reps,
    rir: 1,
    doneAt: START,
    at: START,
  })),
  { kind: "workout", id: DONE, field: "ended", value: END, at: END },
];

async function openSummary(page: Page) {
  await fakeServer(page, { changes: SESSION });
  await page.goto(`/workout/summary/${DONE}`);
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What you logged" })).toBeVisible();
}

test("the summary's figures and list fit at 360 px with nothing scrolling sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openSummary(page);
  await expect(page.locator("dl")).toContainText("Duration1 h 04");
  await expect(page.locator("dl")).toContainText("Sets11");
  await expect(page.getByRole("region", { name: "What you logged" })).toContainText(
    "4 sets · best 82.5 kg × 8",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0);
  // Every figure and every row stays inside the screen.
  const outside = await page.evaluate(
    () =>
      [...document.querySelectorAll("dd, dt, li")]
        .map((el) => el.getBoundingClientRect())
        .filter((box) => box.left < 0 || box.right > window.innerWidth).length,
  );
  expect(outside).toBe(0);
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`the summary has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await openSummary(page);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
});
