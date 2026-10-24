import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// The real clock throughout: the router and the timers read it, so the rest is made short instead.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

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

// Session A open since five minutes ago, the bench press resting only a few seconds.
function open(restSec: number): Change[] {
  const [first, ...rest] = sessionByCode("A")!.slots;
  const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  return [
    ...LAST_A,
    {
      kind: "workout",
      id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01",
      field: "start",
      sessionCode: "A",
      plan: [{ ...first!, restSec }, ...rest],
      startedAt,
      at: startedAt,
    },
  ];
}

type Counted = Window & { __tones: number; __contexts: number };

// The preference as Settings stores it, and the page's audio context counted: every note of the
// tone starts one oscillator, so one tone is two starts.
async function listen(page: Page, sound: "on" | "off") {
  await page.addInitScript((choice) => {
    localStorage.setItem("belay.restSound", choice);
    const counted = window as unknown as Counted;
    counted.__tones = 0;
    counted.__contexts = 0;
    const Real = window.AudioContext;
    window.AudioContext = class extends Real {
      constructor(options?: AudioContextOptions) {
        super(options);
        counted.__contexts++;
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when?: number) => {
          counted.__tones++;
          start(when);
        };
        return oscillator;
      }
    };
  }, sound);
}
const tones = (page: Page) => page.evaluate(() => (window as unknown as Counted).__tones);
const contexts = (page: Page) => page.evaluate(() => (window as unknown as Counted).__contexts);

const bench = (page: Page) => page.getByRole("region", { name: /^Barbell bench press/ });

// Home's card resumes the open session (a tap, so the audio unlocks), then the first set is logged.
async function logFirstSet(page: Page, restSec: number) {
  await fakeServer(page, { changes: open(restSec) });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  const card = page.getByRole("region", { name: /^Session A · / });
  await expect(card).toContainText("In progress");
  await card.getByRole("link", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Session A · / })).toBeVisible();
  await expect(bench(page).getByRole("textbox", { name: "Load of set 1, kg" })).toHaveValue("80");
  await expect(bench(page).getByRole("textbox", { name: "Reps of set 1" })).toHaveValue("8");
  await bench(page).getByRole("button", { name: "Log set 1" }).click();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
}

test("a rest that runs out on the session screen plays one tone", async ({ page }) => {
  await listen(page, "on");
  await logFirstSet(page, 3);
  await expect(page.getByRole("timer")).toBeVisible();
  expect(await tones(page)).toBe(0);
  await expect(page.getByText("Back to it")).toBeVisible({ timeout: 6000 });
  await expect.poll(() => tones(page)).toBe(2);
  // The bar stays up until the next tap: still a single tone a second later.
  await page.waitForTimeout(1000);
  expect(await tones(page)).toBe(2);
  expect(await contexts(page)).toBe(1);
});

test("a rest that runs out under the session bar on Accueil plays one tone", async ({ page }) => {
  await listen(page, "on");
  await logFirstSet(page, 5);
  await page.getByRole("button", { name: "Minimize the session" }).click();
  await expect(page).toHaveURL(/\/$/);
  const bar = page.getByRole("link", { name: /Rest · set 2 of 4 · Session A/ });
  await expect(bar).toBeVisible();
  expect(await tones(page)).toBe(0);
  await expect(page.getByRole("link", { name: /Set 2 of 4 · Session A/ })).toBeVisible({
    timeout: 8000,
  });
  await expect.poll(() => tones(page)).toBe(2);
  await page.waitForTimeout(1000);
  expect(await tones(page)).toBe(2);
});

test("with the sound off no audio context is created", async ({ page }) => {
  await listen(page, "off");
  await logFirstSet(page, 3);
  await expect(page.getByText("Back to it")).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(500);
  expect(await contexts(page)).toBe(0);
  expect(await tones(page)).toBe(0);
});
