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

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f${String(n).padStart(2, "0")}`;
// A session finished at 19:00 Paris time on `day`, as another device sent it.
function finished(
  n: number,
  code: string,
  day: string,
  sets: [slotIndex: number, position: number, kg: number, reps: number][] = [],
): Change[] {
  const startedAt = new Date(`${day}T18:00:00+02:00`).toISOString();
  const endedAt = new Date(`${day}T19:00:00+02:00`).toISOString();
  const plan = [...sessionByCode(code)!.slots];
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: code,
      plan,
      startedAt,
      at: startedAt,
    },
    ...sets.map(([slotIndex, position, weightKg, reps], i): Change => ({
      kind: "set",
      id: id(n * 10 + i),
      workoutId: id(n),
      field: "create",
      slotIndex,
      position,
      exerciseId: plan[slotIndex]!.exerciseId,
      warmup: false,
      weightKg,
      reps,
      seconds: null,
      rir: 2,
      doneAt: startedAt,
      at: startedAt,
    })),
    { kind: "workout", id: id(n), field: "ended", value: endedAt, at: endedAt },
  ];
}
// A then B this week: session C comes next.
const A_THEN_B = [...finished(1, "A", "2026-10-05"), ...finished(2, "B", "2026-10-06")];
const CLIMB: Change = {
  kind: "activity",
  id: id(90),
  field: "fields",
  date: "2026-10-05",
  type: "climbing",
  durationMin: 90,
  cardioType: null,
  climbStyle: "boulder",
  climbRuns: 14,
  climbGrade: "6b+",
  climbColor: null,
  at: "2026-10-05T18:00:00.000Z",
};
// B on Thursday the 1st and on Monday the 5th, the squat at 100 kg × 5 both times.
const TWO_B = [
  ...finished(3, "B", "2026-10-01", [[0, 3, 100, 5]]),
  ...finished(4, "B", "2026-10-05", [[0, 3, 100, 5]]),
];

const card = (page: Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
const sent = (server: Awaited<ReturnType<typeof fakeServer>>) =>
  server.requests.flatMap((r) => r.changes);
const activityLine = (page: Page) => page.getByRole("button", { name: /^Activity/ });

test("a climb is logged from Home in two taps, and reaches the server", async ({ page }) => {
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(activityLine(page)).toContainText("not entered yet");
  await activityLine(page).click();
  const sheet = page.getByRole("dialog", { name: "Activity" });
  await sheet.getByRole("radio", { name: "6b+" }).click();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(activityLine(page)).toContainText("Climbing · 1 h 30 · 6b+");
  await expect
    .poll(() => sent(server).some((c) => c.kind === "activity" && c.field === "fields"))
    .toBe(true);
});

test("session C adds the pulldown and the curl in a week with no climb, and not once climbed", async ({
  page,
  browser,
}) => {
  await fakeServer(page, { changes: A_THEN_B });
  await page.goto("/");
  const line = page.getByRole("region", { name: /^Session C/ });
  await expect(line).toContainText("10 exercises");
  await line.getByRole("link", { name: "See the session" }).click();
  await page.getByRole("link", { name: "Start the session" }).click();
  await expect(
    page.getByText(
      "No climbing this week: vertical pull and curl added at the end of the session.",
    ),
  ).toBeVisible();
  const pulldown = card(page, "Cable lat pulldown full range of motion");
  await expect(pulldown).toContainText("added, no climbing");
  await pulldown.getByRole("button", { name: "Remove" }).click();
  await expect(pulldown).toContainText("left out today");

  // Another phone, where a climb is recorded this week: session C as the program has it.
  const other = await browser.newContext({ locale: "en-US", timezoneId: "Europe/Paris" });
  const second = await other.newPage();
  await second.clock.setFixedTime(NOW);
  await fakeServer(second, { changes: [...A_THEN_B, CLIMB] });
  await second.goto("/");
  const secondCard = second.getByRole("region", { name: /^Session C/ });
  await expect(secondCard).toContainText("8 exercises");
  await secondCard.getByRole("link", { name: "See the session" }).click();
  await second.getByRole("link", { name: "Start the session" }).click();
  await expect(card(second, "Barbell hip thrust")).toBeVisible();
  await expect(second.getByText(/No climbing this week/)).toBeHidden();
  await other.close();
});

test("an exercise replaced during the session keeps the sets done, after a reload too", async ({
  page,
}) => {
  const server = await fakeServer(page, { changes: finished(1, "A", "2026-10-05") });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await page
    .getByRole("region", { name: /^Session B/ })
    .getByRole("link", { name: "See the session" })
    .click();
  await page.getByRole("link", { name: "Start the session" }).click();
  const squat = card(page, "Barbell full squat");
  await squat.getByRole("textbox", { name: "Load of set 1, kg" }).fill("100");
  await squat.getByRole("textbox", { name: "Reps of set 1" }).fill("5");
  await squat.getByRole("button", { name: "Log set 1" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await squat.getByRole("button", { name: "Replace" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Dumbbell goblet squat/ })
    .click();
  const goblet = card(page, "Dumbbell goblet squat");
  await expect(goblet).toContainText("1 set done with Barbell full squat");
  await goblet.getByRole("textbox", { name: "Load of set 2, kg" }).fill("24");
  await goblet.getByRole("textbox", { name: "Reps of set 2" }).fill("10");
  await goblet.getByRole("button", { name: "Log set 2" }).click();
  await expect
    .poll(() =>
      sent(server)
        .filter((c) => c.kind === "set" && c.field === "create")
        .map((c) => (c.kind === "set" && c.field === "create" ? c.exerciseId : "")),
    )
    .toEqual(["ds:0043", "ds:1760"]);
  expect(sent(server).some((c) => c.kind === "workout" && c.field === "plan")).toBe(true);
  // The session's own plan stays after a reload; the program itself is not touched (unit tested).
  await page.reload();
  await expect(card(page, "Dumbbell goblet squat")).toContainText(
    "1 set done with Barbell full squat",
  );
});

test("a past session corrected, and its record follows", async ({ page }) => {
  const server = await fakeServer(page, { changes: TWO_B });
  await page.goto(`/workouts/${id(4)}`);
  await expect(page.getByRole("heading", { name: "Session B · Legs", level: 1 })).toBeVisible();
  await expect(page.getByText(/^Record/)).toBeHidden(); // as much as Thursday
  await page.getByRole("link", { name: "Edit" }).click();
  await card(page, "Barbell full squat")
    .getByRole("textbox", { name: "Load of set 1, kg" })
    .fill("105");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Record: Barbell full squat, 105 kg × 5")).toBeVisible();
  await expect
    .poll(() => sent(server).some((c) => c.kind === "set" && c.field === "values"))
    .toBe(true);
});

test("yesterday's session is logged afterwards and filed on its day", async ({ page }) => {
  const server = await fakeServer(page, { changes: finished(1, "A", "2026-10-05") });
  await page.goto("/workouts?tab=history");
  await page.getByRole("button", { name: "Log a session" }).click();
  const sheet = page.getByRole("dialog", { name: "Log a session" });
  await sheet.getByLabel("Date of the session").fill("2026-10-06");
  await sheet.getByRole("radio", { name: "B" }).click();
  await sheet.getByRole("button", { name: "Enter the sets" }).click();
  await expect(page.getByRole("heading", { name: "Session B · Legs", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^Barbell full squat/ }).click();
  const squat = card(page, "Barbell full squat");
  await squat.getByRole("button", { name: "+ Set" }).click();
  await squat.getByRole("textbox", { name: "Load of set 1, kg" }).fill("100");
  await squat.getByRole("textbox", { name: "Reps of set 1" }).fill("5");
  await page.getByRole("button", { name: "Save" }).click();
  // A session logged afterwards starts at noon on its day.
  await expect(page.getByText(/^Tuesday, October 6 · 12:00\sPM$/)).toBeVisible();
  const figures = page.locator("main dl");
  await expect(figures.getByRole("definition")).toHaveText(["1 h 00", "1", /^500 kg$/]);
  await page.goto("/workouts?tab=history");
  await expect(page.getByRole("region", { name: "Recent" }).getByRole("link").first()).toHaveText(
    /Tue, Oct 6 · 1 h 00\s*Session B · Legs/,
  );
  await expect
    .poll(() =>
      sent(server)
        .filter((c) => c.kind === "workout")
        .map((c) => (c.kind === "workout" ? c.field : "")),
    )
    .toEqual(["start", "ended"]);
});

// Each new screen, as a person reaches it, for axe and for the 360 px check.
const openActivity = async (page: Page) => {
  await page.goto("/");
  await activityLine(page).click();
  return page.getByRole("dialog", { name: "Activity" });
};
const addHang = async (page: Page) => {
  await page.goto("/workout?start=A");
  await page.getByRole("button", { name: "+ Exercise" }).click();
  const sheet = page.getByRole("dialog", { name: "Add an exercise" });
  await sheet.getByRole("searchbox").fill("dead hang");
  await sheet.getByRole("button", { name: /^Dead hang/ }).click();
  return card(page, "Dead hang");
};
const SCREENS: [string, Change[], (page: Page) => Promise<void>][] = [
  [
    "the activity sheet, a climb by grade",
    [],
    async (page) => {
      const sheet = await openActivity(page);
      await expect(sheet.getByRole("radio", { name: "8c+" })).toBeVisible();
    },
  ],
  [
    "the activity sheet, a climb by colour",
    [],
    async (page) => {
      const sheet = await openActivity(page);
      await sheet.getByRole("radio", { name: "Color" }).click();
      await sheet.getByRole("radio", { name: "blue" }).click();
      await expect(sheet.getByText("blue", { exact: true })).toBeVisible();
    },
  ],
  [
    "the activity sheet, cardio",
    [],
    async (page) => {
      const sheet = await openActivity(page);
      await sheet.getByRole("radio", { name: "Cardio" }).click();
      await expect(sheet.getByRole("radio", { name: "Swim" })).toBeVisible();
    },
  ],
  [
    "the activity sheet, steps",
    [],
    async (page) => {
      const sheet = await openActivity(page);
      await sheet.getByRole("radio", { name: "Steps" }).click();
      await expect(sheet.getByRole("textbox", { name: "Steps of the day" })).toBeVisible();
    },
  ],
  [
    "session C with its rule",
    A_THEN_B,
    async (page) => {
      await page.goto("/workout?start=C");
      await expect(page.getByText(/No climbing this week/)).toBeVisible();
      await expect(card(page, "Dumbbell biceps curl")).toContainText("added, no climbing");
    },
  ],
  [
    "the replace sheet",
    [],
    async (page) => {
      await page.goto("/workout?start=B");
      await card(page, "Barbell full squat").getByRole("button", { name: "Replace" }).click();
      await expect(page.getByRole("region", { name: "Planned in your program" })).toBeVisible();
    },
  ],
  [
    "the add-exercise sheet, searched",
    [],
    async (page) => {
      await page.goto("/workout?start=A");
      await page.getByRole("button", { name: "+ Exercise" }).click();
      const sheet = page.getByRole("dialog", { name: "Add an exercise" });
      await sheet.getByRole("searchbox").fill("plank");
      await expect(sheet.getByRole("status")).toBeVisible();
    },
  ],
  [
    "a timed exercise, its chrono running",
    [],
    async (page) => {
      const hang = await addHang(page);
      await hang.getByRole("button", { name: "Timer 0:30" }).click();
      await expect(hang.getByRole("timer")).toBeVisible();
    },
  ],
  [
    "History with an activity",
    [...TWO_B, CLIMB],
    async (page) => {
      await page.goto("/workouts?tab=history");
      await expect(page.getByRole("list", { name: "Legend" })).toBeVisible();
      await expect(page.getByRole("button", { name: /Climbing · 1 h 30/ })).toBeVisible();
    },
  ],
  [
    "the log-a-session sheet",
    TWO_B,
    async (page) => {
      await page.goto("/workouts?tab=history");
      await page.getByRole("button", { name: "Log a session" }).click();
      await expect(page.getByRole("spinbutton", { name: "Duration" })).toBeVisible();
    },
  ],
  [
    "the editor",
    TWO_B,
    async (page) => {
      await page.goto(`/workout/edit?id=${id(4)}`);
      await expect(
        card(page, "Barbell full squat").getByRole("button", { name: "Delete set 1" }),
      ).toBeVisible();
    },
  ],
  [
    "the program as cards",
    TWO_B,
    async (page) => {
      await page.goto("/workouts?tab=program");
      await expect(page.getByText(/Next up/)).toBeVisible();
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
  for (const [name, changes, open] of SCREENS) {
    test(`${name} fits without sideways scrolling`, async ({ page }) => {
      await fakeServer(page, { changes });
      await open(page);
      await expectFits(page);
    });
  }
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    // One test per screen and theme, each on a fresh device.
    for (const [name, changes, open] of SCREENS) {
      test(`${name} has no axe violation, ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
        await fakeServer(page, { changes });
        await open(page);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        await expectNoAxeViolations(page);
      });
    }
  }
});
