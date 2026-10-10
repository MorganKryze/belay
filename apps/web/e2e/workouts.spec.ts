import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// Wednesday 7 October 2026, 6 p.m. in Paris; the clock stands still unless a test moves it.
const NOW = new Date("2026-10-07T18:00:00+02:00");
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const MONDAY = "2026-10-05T16:00:00.000Z";
const MONDAY_END = "2026-10-05T17:04:00.000Z";
// Session A on Monday, as another device sent it: the bench press at 80 kg × 8, 8, 7, 6.
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: MONDAY,
    at: MONDAY,
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
    doneAt: MONDAY,
    at: MONDAY,
  })),
  { kind: "workout", id: LAST, field: "ended", value: MONDAY_END, at: MONDAY_END },
];

const card = (page: Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
// The two warm-ups of the bench press, one after the other.
async function logWarmups(bench: Locator) {
  for (const n of [1, 2]) {
    await bench.getByRole("button", { name: `Log warm-up ${n}` }).click();
    await expect(bench.getByRole("img", { name: `Warm-up ${n} logged` })).toBeVisible();
  }
}
const sessionLine = (page: Page) => page.getByRole("link", { name: /^Session [ABC] · / });

// Logs one work set: types the load and reps when nothing is prefilled, then ✓, then skips
// the rest so the fixed bar never covers the next card.
async function logSet(page: Page, exercise: string, n: number, kg: string, reps: string) {
  const c = card(page, exercise);
  const load = c.getByRole("textbox", { name: `Load of set ${n}, kg` });
  if ((await load.inputValue()) === "") {
    await load.fill(kg);
    await c.getByRole("textbox", { name: `Reps of set ${n}` }).fill(reps);
  }
  await c.getByRole("button", { name: `Log set ${n}` }).click();
  // Logged: its button goes (and the card folds when the next exercise opens).
  await expect(c.getByRole("button", { name: `Log set ${n}` })).toBeHidden();
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible()) await skip.click();
}

// Session A in the program's order: the three main lifts, then the tri-set round by round.
const SESSION_A: [string, string, string, number][] = [
  ["Barbell bench press", "60", "8", 4],
  ["Dumbbell seated shoulder press", "16", "10", 3],
  ["Sled 45° leg press", "100", "12", 3],
];
const TRISET: [string, string, string][] = [
  ["Dumbbell lateral raise", "8", "15"],
  ["Cable pushdown", "25", "12"],
  ["Lever standing calf raise", "60", "12"],
];

test("a whole session offline: summary, history, and a second device sees it", async ({
  page,
  browser,
}) => {
  const server = await fakeServer(page);
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(sessionLine(page)).toContainText("6 exercises · about 55 min");

  server.offline = true;
  await page.context().setOffline(true);
  await sessionLine(page).click();
  await expect(page.getByRole("heading", { name: "Session A · Push", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  for (const [exercise, kg, reps, sets] of SESSION_A)
    for (let n = 1; n <= sets; n++) await logSet(page, exercise, n, kg, reps);
  for (let n = 1; n <= 3; n++)
    for (const [exercise, kg, reps] of TRISET) await logSet(page, exercise, n, kg, reps);
  // Every work set done: Finish asks nothing.
  await page.clock.setFixedTime(new Date(NOW.getTime() + 62 * 60_000));
  await page.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByRole("heading", { name: "Session done", level: 1 })).toBeVisible();
  const stats = page.locator("dl");
  await expect(stats).toContainText("Duration1 h 02");
  await expect(stats).toContainText("Work sets19");
  await page.getByRole("textbox", { name: "Session note (optional)" }).fill("Bonne séance");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(sessionLine(page)).toContainText("Session B · Legs");

  await page.getByRole("link", { name: "Sessions" }).click();
  await page.getByRole("radio", { name: "History" }).click();
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent.getByRole("link")).toHaveText(/Wed, Oct 7Session A · Push1 h 02/);

  // Back online: the session goes in one queue, and another device gets all of it.
  server.offline = false;
  await page.context().setOffline(false);
  await expect
    .poll(() => server.requests.flatMap((r) => r.changes).filter((c) => c.kind === "set").length)
    .toBe(19);
  const other = await browser.newContext({ locale: "en-US", timezoneId: "Europe/Paris" });
  const second = await other.newPage();
  await second.clock.setFixedTime(new Date(NOW.getTime() + 70 * 60_000));
  await fakeServer(second, { changes: server.requests.flatMap((r) => r.changes) });
  await second.goto("/workouts?tab=history");
  await second.getByRole("link", { name: /Session A · Push/ }).click();
  await expect(second.getByText(/62 min|1 h 02/)).toBeVisible();
  await expect(second.getByText("Bonne séance")).toBeVisible();
  await expect(
    second.getByRole("region", { name: "Barbell bench press" }).getByRole("listitem"),
  ).toHaveCount(4);
  await other.close();
});

test("a reload in the middle of a rest comes back to the same set and time left", async ({
  page,
}) => {
  await fakeServer(page, { changes: LAST_A });
  await page.goto("/workouts?tab=program");
  await page.getByRole("link", { name: "Start" }).first().click();
  const bench = card(page, "Barbell bench press");
  await expect(bench.getByRole("textbox", { name: "Load of set 1, kg" })).toHaveValue("80");
  await logWarmups(bench);
  await bench.getByRole("button", { name: "Log set 1" }).click();
  await expect(page.getByRole("timer")).toHaveText("2:30");
  await page.clock.setFixedTime(new Date(NOW.getTime() + 60_000));
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("1:30");
  await expect(
    card(page, "Barbell bench press").getByRole("img", { name: "Set 1 logged" }),
  ).toBeVisible();
  await expect(card(page, "Barbell bench press").getByRole("radiogroup")).toBeVisible();
});

test("a session deleted from the history leaves it, here and on the server", async ({ page }) => {
  const server = await fakeServer(page, { changes: LAST_A });
  await page.goto("/workouts?tab=history");
  await page.getByRole("link", { name: /Session A · Push/ }).click();
  await page.getByRole("button", { name: "Delete this session" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Your first session will show here.")).toBeVisible();
  await expect
    .poll(() =>
      server.requests
        .flatMap((r) => r.changes)
        .some((c) => c.kind === "workout" && c.field === "removed"),
    )
    .toBe(true);
});

// Each new screen, as a person reaches it, for axe and for the 360 px check.
const SCREENS: [string, (page: Page) => Promise<void>][] = [
  [
    "History",
    async (page) => {
      await page.goto("/workouts?tab=history");
      await expect(page.getByRole("table", { name: "October 2026" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Session A · Push/ })).toBeVisible();
    },
  ],
  [
    "Program",
    async (page) => {
      await page.goto("/workouts?tab=program");
      await expect(page.getByRole("link", { name: "Start" }).first()).toBeVisible();
    },
  ],
  [
    "Exercises",
    async (page) => {
      await page.goto("/workouts?tab=exercises");
      await expect(page.getByRole("heading", { name: "All · 1,290" })).toBeVisible();
    },
  ],
  [
    "the muscle filter",
    async (page) => {
      await page.goto("/workouts?tab=exercises");
      await page.getByRole("button", { name: "Muscle" }).click();
      await expect(page.getByRole("dialog", { name: "Muscle" })).toBeVisible();
    },
  ],
  [
    "an exercise",
    async (page) => {
      await page.goto("/exercises/ds:0025");
      await expect(page.getByRole("heading", { name: "How to do it" })).toBeVisible();
      await expect(page.getByRole("listitem").first()).toBeVisible();
    },
  ],
  [
    "a session's detail",
    async (page) => {
      await page.goto(`/workouts/${LAST}`);
      await expect(page.getByRole("button", { name: "Delete this session" })).toBeVisible();
    },
  ],
  [
    "the session screen, resting",
    async (page) => {
      await page.goto("/workout?start=A");
      const bench = card(page, "Barbell bench press");
      await logWarmups(bench);
      await bench.getByRole("button", { name: "Log set 1" }).click();
      await expect(page.getByRole("timer")).toBeVisible();
      await expect(bench.getByRole("radiogroup")).toBeVisible();
    },
  ],
  [
    "the finish question",
    async (page) => {
      await page.goto("/workout?start=A");
      await card(page, "Barbell bench press").getByRole("button", { name: "Log set 1" }).click();
      await page.getByRole("button", { name: "Finish" }).click();
      await expect(page.getByRole("dialog", { name: "Finish the session?" })).toBeVisible();
    },
  ],
  [
    "the summary",
    async (page) => {
      await page.goto("/workout?start=A");
      await card(page, "Barbell bench press")
        .getByRole("textbox", { name: "Load of set 1, kg" })
        .fill("82.5");
      await card(page, "Barbell bench press").getByRole("button", { name: "Log set 1" }).click();
      await page.getByRole("button", { name: "Finish" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Finish" }).click();
      await expect(page.getByText("Record: Barbell bench press, 82.5 kg × 8")).toBeVisible();
    },
  ],
];

// A sheet is a fixed dialog: the page can fit while the dialog itself scrolls sideways.
async function expectFits(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  const dialog: Locator = page.getByRole("dialog");
  if ((await dialog.count()) === 0) return;
  expect(
    await dialog.first().evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(0);
}

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 780 } });
  for (const [name, open] of SCREENS) {
    test(`${name} fits without sideways scrolling`, async ({ page }) => {
      await fakeServer(page, { changes: LAST_A });
      await open(page);
      await expectFits(page);
    });
  }
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    // One test per screen, each on a fresh device: a session started for one is not open in the
    // next, and each stays well inside the timeout on a slow runner.
    for (const [name, open] of SCREENS) {
      test(`${name} has no axe violation, ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
        await fakeServer(page, { changes: LAST_A });
        await open(page);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        await expectNoAxeViolations(page);
      });
    }
  }
});
