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
// Accueil's card for the day's session, named by its title.
const sessionCard = (page: Page) => page.getByRole("region", { name: /^Session [ABC] · / });

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
  await expect(sessionCard(page)).toContainText("Session A · Push");
  await expect(sessionCard(page)).toContainText("Next up · 6 exercises · about 55 min");

  server.offline = true;
  await page.context().setOffline(true);
  await sessionCard(page).getByRole("link", { name: "See the session" }).click();
  await page.getByRole("link", { name: "Start the session" }).click();
  await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Session A · Push", level: 1 })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  for (const [exercise, kg, reps, sets] of SESSION_A)
    for (let n = 1; n <= sets; n++) await logSet(page, exercise, n, kg, reps);
  for (let n = 1; n <= 3; n++)
    for (const [exercise, kg, reps] of TRISET) await logSet(page, exercise, n, kg, reps);
  // Every work set done: Finish still asks, and says nothing is left.
  await page.clock.setFixedTime(new Date(NOW.getTime() + 62 * 60_000));
  await page.getByRole("button", { name: "Finish" }).click();
  const sheet = page.getByRole("dialog", { name: "Finish the session?" });
  await expect(sheet).toContainText("19 sets logged out of 19; your program doesn't change.");
  await sheet.getByRole("button", { name: "Finish and save" }).click();
  await expect(page.getByText(/^Session done · /)).toBeVisible();
  const stats = page.locator("dl");
  await expect(stats).toContainText("Duration1 h 02");
  await expect(stats).toContainText("Sets19");
  await page.getByRole("textbox", { name: "Session note (optional)" }).fill("Bonne séance");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(sessionCard(page)).toContainText("Session B · Legs");

  await page.getByRole("link", { name: "Sessions" }).click();
  await page.getByRole("radio", { name: "History" }).click();
  const recent = page.getByRole("region", { name: "Recent" });
  await expect(recent.getByRole("link")).toHaveText(/Wed, Oct 7 · 1 h 02\s*Session A · Push/);

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
  // B is next after Monday's A: A's card is further down and opens its preview.
  await expect(page.locator(".launch")).toBeHidden();
  await page.getByRole("link", { name: /^Session A · Push/ }).click();
  await page.getByRole("link", { name: "Start the session" }).click();
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

// Session C started ten minutes ago, two sets of the hip thrust done: the third is up next.
const RUNNING = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const TEN_AGO = new Date(NOW.getTime() - 10 * 60_000).toISOString();
const RUNNING_C: Change[] = [
  {
    kind: "workout",
    id: RUNNING,
    field: "start",
    sessionCode: "C",
    plan: [...sessionByCode("C")!.slots],
    startedAt: TEN_AGO,
    at: TEN_AGO,
  },
  ...[0, 1].map((k): Change => ({
    kind: "set",
    id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f1${k}`,
    workoutId: RUNNING,
    field: "create",
    slotIndex: 0,
    position: 3 + k,
    exerciseId: "belay:barbell-hip-thrust",
    warmup: false,
    weightKg: 80,
    reps: 10,
    rir: 1,
    doneAt: TEN_AGO,
    at: TEN_AGO,
  })),
];
const sessionBar = (page: Page) =>
  page.getByRole("link", { name: /^Barbell hip thrust Set 3 of 4 · Session C/ });

test("the running session sits above the tabs and reopens in one tap", async ({ page }) => {
  await fakeServer(page, { changes: RUNNING_C });
  await page.goto("/tools");
  const bar = sessionBar(page);
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("10:00");
  const tabs = await page.getByRole("navigation", { name: "Main" }).boundingBox();
  const box = await bar.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(tabs!.y);
  await bar.click();
  await expect(page.getByRole("heading", { level: 1, name: /^Session C · / })).toBeVisible();
  await expect(sessionBar(page)).toBeHidden();
});

test("the session bar's status line fits whole at 390 px, in the secondary size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeServer(page, { changes: RUNNING_C });
  await page.goto("/tools");
  const line = sessionBar(page).getByText("Set 3 of 4 · Session C");
  await expect(line).toBeVisible();
  const { size, cut } = await line.evaluate((el) => ({
    size: getComputedStyle(el).fontSize,
    cut: el.scrollWidth > el.clientWidth,
  }));
  expect(size).toBe("13px");
  expect(cut).toBe(false);
});

for (const theme of ["light", "dark"] as const) {
  test(`the session bar and the tabs share a backing with no separator line, ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await fakeServer(page, { changes: RUNNING_C });
    await page.goto("/tools");
    await expect(sessionBar(page)).toBeVisible();
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    const lines = await page.evaluate(() => {
      const dock = document.querySelector("[data-dock]")!;
      const bar = dock.querySelector('a[href^="/workout"]')!;
      const drawn = (el: Element, pseudo?: string) => {
        const s = getComputedStyle(el, pseudo);
        const sides = ["Top", "Right", "Bottom", "Left"] as const;
        const border = sides.some(
          (side) =>
            s.getPropertyValue(`border-${side.toLowerCase()}-style`) !== "none" &&
            parseFloat(s.getPropertyValue(`border-${side.toLowerCase()}-width`)) > 0,
        );
        const content = pseudo ? s.content !== "none" && s.content !== "normal" : false;
        return border || content;
      };
      return [dock, bar, bar.parentElement!].flatMap((el) => [
        drawn(el),
        drawn(el, "::before"),
        drawn(el, "::after"),
      ]);
    });
    expect(lines).toEqual(Array(9).fill(false));
  });
}

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
      await expect(page.getByRole("link", { name: "See the session" })).toBeVisible();
    },
  ],
  [
    "Exercises",
    async (page) => {
      await page.goto("/workouts?tab=exercises");
      await expect(page.getByRole("heading", { name: "All · 1,291" })).toBeVisible();
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
      const bench = card(page, "Barbell bench press");
      await expect(bench.getByRole("textbox", { name: "Reps of set 1" })).toHaveValue("8");
      await bench.getByRole("button", { name: "Log set 1" }).click();
      // Logged before Finish: with nothing logged the other sheet opens.
      await expect(bench.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
      await page.getByRole("button", { name: "Finish" }).click();
      await expect(page.getByRole("dialog", { name: "Finish the session?" })).toBeVisible();
    },
  ],
  [
    "the summary",
    async (page) => {
      await page.goto("/workout?start=A");
      const bench = card(page, "Barbell bench press");
      const load = bench.getByRole("textbox", { name: "Load of set 1, kg" });
      // Monday's 80 kg reaches the empty field with the first sync: typed before, it would land
      // after the caret and read 8082.5.
      await expect(load).toHaveValue("80");
      await load.fill("82.5");
      await bench.getByRole("button", { name: "Log set 1" }).click();
      await expect(bench.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
      await page.getByRole("button", { name: "Finish" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Finish and save" }).click();
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

// Each row sits in a rounded card that clips its overflow: a ring drawn outside the row would vanish.
test("the remove-session action sheet shows the keyboard focus ring inside each row", async ({
  page,
}) => {
  await fakeServer(page, { changes: LAST_A });
  await page.goto("/workouts?tab=history");
  await page.getByRole("link", { name: /Session A · Push/ }).click();
  const remove = page.getByRole("button", { name: "Delete this session" });
  await remove.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Delete this session?" });
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  const confirm = dialog.getByRole("button", { name: "Delete" });
  await expect(confirm).toBeFocused();
  for (const button of [confirm, cancel]) {
    await button.focus();
    const ring = await button.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        focusVisible: el.matches(":focus-visible"),
        style: s.outlineStyle,
        width: parseFloat(s.outlineWidth),
        reach: parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset),
      };
    });
    expect(ring.focusVisible).toBe(true);
    expect(ring.style).toBe("solid");
    expect(ring.width).toBeGreaterThan(0);
    // The ring's outer edge stays on or inside the row's border box, so the card does not clip it.
    expect(ring.reach).toBeLessThanOrEqual(0);
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
    test(`the session bar has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page, { changes: RUNNING_C });
      await page.goto("/tools");
      await expect(sessionBar(page)).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
    test(`the remove-session action sheet has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workouts?tab=history");
      await page.getByRole("link", { name: /Session A · Push/ }).click();
      await page.getByRole("button", { name: "Delete this session" }).click();
      await expect(page.getByRole("dialog", { name: "Delete this session?" })).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
});

test("Programme cards sit on the card surface", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeServer(page, { changes: LAST_A });
  const titles = page.getByRole("heading", { level: 2, name: /^Session / });
  // Each card: the region its title names, or the link that is the whole card.
  const surfaces = () =>
    titles.evaluateAll((hs) =>
      hs.map((h) => {
        const s = getComputedStyle(h.closest("a, section[aria-labelledby]")!);
        return { shadow: s.boxShadow, border: s.borderTopWidth };
      }),
    );
  await page.addInitScript(() => localStorage.setItem("belay.theme", "light"));
  await page.goto("/workouts?tab=program");
  await expect(titles).toHaveCount(3);
  const light = await surfaces();
  for (const s of light) {
    expect(s.shadow).toContain("rgba(28, 25, 23, 0.035) 0px 0px 0px 1px");
    expect(s.border).toBe("0px");
  }
  await page.addInitScript(() => localStorage.setItem("belay.theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(titles).toHaveCount(3);
  expect(await surfaces()).toEqual(Array(3).fill({ shadow: "none", border: "1px" }));
});
