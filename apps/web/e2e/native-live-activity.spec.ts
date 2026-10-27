import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";
import { activityCalls, asIPhone, shownActivity } from "./native";

// The real clock throughout: the times the app describes are read against the time that passes.
test.use({ locale: "fr-FR" });

const A = sessionByCode("A", starterProgram)!;
const BENCH = A.slots[0]!;

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
    plan: [...A.slots],
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
const status = async (page: Page) => (await shownActivity(page))?.state.status;
// A time the app described, against the test's clock: within a few seconds.
const near = (time: unknown, expected: number) => {
  expect(time).toEqual(expect.any(Number));
  expect(Math.abs((time as number) - expected)).toBeLessThan(3000);
};

// The iPhone app signed in to an instance at the preview's own address, so the fake server's
// routes answer it there with no cross-origin rules in the way. Session A started on it, its
// first set prefilled from last time.
async function start(page: Page, baseURL: string) {
  await asIPhone(page, { instance: baseURL, token: "a".repeat(43) });
  await fakeServer(page, { changes: LAST_A });
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(bench(page).getByRole("textbox", { name: "Charge de la série 1, kg" })).toHaveValue(
    "80",
  );
  await expect(bench(page).getByRole("textbox", { name: "Répétitions de la série 1" })).toHaveValue(
    "8",
  );
}

async function logFirstSet(page: Page) {
  await bench(page).getByRole("button", { name: "Valider la série 1" }).click();
  await expect(bench(page).getByRole("img", { name: "Série 1 validée" })).toBeVisible();
  await expect.poll(() => status(page)).toBe("rest");
}

test("starting session A shows the bench press, « Série 1 sur 4 · Séance A »", async ({
  page,
  baseURL,
}) => {
  await start(page, baseURL!);
  await expect.poll(() => status(page)).toBe("due");
  const { state } = (await shownActivity(page))!;
  expect(state).toMatchObject({
    title: "Barbell bench press",
    detail: `Série 1 sur ${BENCH.sets} · Séance A`,
    statusLabel: "En cours",
    pausedAt: null,
    restStart: null,
    restEnd: null,
  });
  near(state.startedAt, Date.now());
});

test("logging set 1 shows a rest as long as the slot's planned rest, stale at its end", async ({
  page,
  baseURL,
}) => {
  await start(page, baseURL!);
  await logFirstSet(page);
  const activity = (await shownActivity(page))!;
  const { state } = activity;
  expect(state.statusLabel).toBe("Repos");
  expect((state.restEnd as number) - (state.restStart as number)).toBe(BENCH.restSec * 1000);
  near(state.restEnd, Date.now() + BENCH.restSec * 1000);
  expect(activity.staleAt).toBe(state.restEnd);
});

test("no call while the rest counts down", async ({ page, baseURL }) => {
  await start(page, baseURL!);
  await logFirstSet(page);
  const calls = await activityCalls(page);
  await page.waitForTimeout(2500);
  expect(await activityCalls(page)).toBe(calls);
});

test("a pause freezes it, the resume runs it again", async ({ page, baseURL }) => {
  await start(page, baseURL!);
  await logFirstSet(page);
  const before = (await shownActivity(page))!.state.restEnd as number;
  await page.getByRole("button", { name: "Mettre la séance en pause" }).click();
  await expect.poll(() => status(page)).toBe("paused");
  const paused = (await shownActivity(page))!.state;
  // Everything stops during a pause by default, the rest included.
  expect(paused).toMatchObject({ statusLabel: "En pause", restFrozen: true, restEnd: before });
  near(paused.pausedAt, Date.now());
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Reprendre", exact: true }).click();
  await expect.poll(() => status(page)).toBe("rest");
  const resumed = (await shownActivity(page))!.state;
  expect(resumed).toMatchObject({ pausedAt: null, restFrozen: false });
  expect(resumed.restEnd as number).toBeGreaterThan(before + 1000);
});

test("finishing the session ends it", async ({ page, baseURL }) => {
  await start(page, baseURL!);
  await logFirstSet(page);
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Terminer la séance ?" })
    .getByRole("button", { name: "Terminer et enregistrer" })
    .click();
  await expect.poll(() => shownActivity(page)).toBeNull();
});

test("a signed-out iPhone ends any Activity once", async ({ page, baseURL }) => {
  await asIPhone(page, { instance: baseURL! });
  const server = await fakeServer(page);
  server.session = "expired";
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("button", { name: "Se connecter" })).toBeVisible();
  await expect.poll(() => shownActivity(page)).toBeNull();
  await page.waitForTimeout(500);
  expect(await activityCalls(page)).toBe(1);
});
