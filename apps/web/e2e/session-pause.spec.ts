import type { Change } from "@belay/shared/sync/schema";
import { resumedStart } from "@belay/shared/training/pause";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { ADA, fakeServer } from "./fake-server";
import { readMotion, recordMotion } from "./motion";

// The real clock throughout: the session time is read against the time that passes.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
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
const pauseButton = (page: Page) => page.getByRole("button", { name: "Pause the session" });
const tag = (page: Page) => page.getByText("Paused", { exact: true });
const banner = (page: Page) => page.getByText("The timer starts again as soon as you log a set.");

// The session time in the header, in whole seconds.
const elapsed = async (page: Page) => {
  const text = (await page.getByText("Elapsed time").locator("..").textContent())!;
  const [, m, s] = /(\d+):(\d\d)/.exec(text)!;
  return Number(m) * 60 + Number(s);
};

// Session A started on this device, its cells prefilled from last time.
async function start(page: Page) {
  const server = await fakeServer(page, { changes: LAST_A });
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(bench(page).getByRole("textbox", { name: "Load of set 1, kg" })).toHaveValue("80");
  await expect(bench(page).getByRole("textbox", { name: "Reps of set 1" })).toHaveValue("8");
  return server;
}

async function pause(page: Page) {
  await pauseButton(page).click();
  await expect(tag(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
}

async function log(page: Page, n: number) {
  await expect(bench(page).getByRole("textbox", { name: `Reps of set ${n}` })).toHaveValue(/\d/);
  await bench(page)
    .getByRole("button", { name: `Log set ${n}` })
    .click();
  await expect(bench(page).getByRole("img", { name: `Set ${n} logged` })).toBeVisible();
}

// This device's open session, read from its own store.
const openSession = (page: Page) =>
  page.evaluate(
    (id) =>
      new Promise<{ pausedAt?: string | null } | undefined>((resolve, reject) => {
        const open = indexedDB.open(`belay.${id}`);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const get = db.transaction("activeSession").objectStore("activeSession").get("current");
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            db.close();
            resolve(get.result as { pausedAt?: string | null } | undefined);
          };
        };
      }),
    ADA.id,
  );

// What the device sent and what it still holds to send, each change once.
async function changes(page: Page, server: Awaited<ReturnType<typeof fakeServer>>) {
  const queued = await page.evaluate(
    (id) =>
      new Promise<Change[]>((resolve, reject) => {
        const open = indexedDB.open(`belay.${id}`);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction("outbox").objectStore("outbox").getAll();
          all.onerror = () => reject(all.error);
          all.onsuccess = () => {
            db.close();
            resolve((all.result as { change: Change }[]).map((e) => e.change));
          };
        };
      }),
    ADA.id,
  );
  const all = [...server.requests.flatMap((r) => r.changes), ...queued];
  return all.filter((c, i) => all.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
}

test("pause freezes the time and a checked set resumes it from where it stood", async ({
  page,
}) => {
  await start(page);
  await expect.poll(() => elapsed(page)).toBeGreaterThanOrEqual(2);
  await pause(page);
  await expect(page.getByRole("button", { name: "Resume the session" })).toBeVisible();
  const frozen = await elapsed(page);
  await page.waitForTimeout(2200);
  expect(await elapsed(page)).toBe(frozen);
  await log(page, 1);
  await expect(tag(page)).toHaveCount(0);
  await expect(banner(page)).toBeHidden();
  await expect(pauseButton(page)).toBeVisible();
  const resumed = await elapsed(page);
  expect([frozen, frozen + 1]).toContain(resumed);
  await page.waitForTimeout(1500);
  expect(await elapsed(page)).toBeGreaterThan(resumed);
});

test("a pause stops the rest by default, and lets it run once Réglages says so", async ({
  page,
}) => {
  await start(page);
  await log(page, 1);
  const timer = page.getByRole("timer");
  await expect(timer).toBeVisible();
  const seconds = async () => {
    const [m, s] = (await timer.textContent())!.split(":").map(Number);
    return m! * 60 + s!;
  };
  await pause(page);
  const frozen = await seconds();
  await page.waitForTimeout(3000);
  expect(await seconds()).toBe(frozen);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(tag(page)).toHaveCount(0);
  await expect.poll(seconds).toBeLessThan(frozen);
  // Rest continues: a pause leaves the countdown going.
  await page.goto("/settings");
  await expect(page.locator(".launch")).toBeHidden();
  await page.getByRole("combobox", { name: "Sessions · Paused · Everything stops" }).click();
  await page.getByRole("option", { name: "Rest continues" }).click();
  await expect(
    page.getByRole("combobox", { name: "Sessions · Paused · Rest continues" }),
  ).toBeVisible();
  await page.goto("/workout");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(timer).toBeVisible();
  await pause(page);
  const first = await seconds();
  await page.waitForTimeout(1500);
  expect(await seconds()).toBeLessThan(first);
});

test("a reload keeps the pause and its frozen time", async ({ page }) => {
  await start(page);
  await expect.poll(() => elapsed(page)).toBeGreaterThanOrEqual(1);
  await pause(page);
  const frozen = await elapsed(page);
  await page.reload();
  await expect(page.locator(".launch")).toBeHidden();
  await expect(tag(page)).toBeVisible();
  await expect(banner(page)).toBeVisible();
  expect(await elapsed(page)).toBe(frozen);
  await page.waitForTimeout(1100);
  expect(await elapsed(page)).toBe(frozen);
});

test("Resume in the banner sends the moved start", async ({ page }) => {
  const server = await start(page);
  await pause(page);
  const pausedAt = (await openSession(page))?.pausedAt;
  expect(pausedAt).toEqual(expect.any(String));
  const startedAt = (await changes(page, server)).flatMap((c) =>
    c.kind === "workout" && c.field === "start" && c.id !== LAST ? [c.startedAt] : [],
  )[0]!;
  await page.waitForTimeout(2000);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(tag(page)).toHaveCount(0);
  const moves = async () =>
    (await changes(page, server)).flatMap((c) =>
      c.kind === "workout" && c.field === "startedAt" ? [c] : [],
    );
  await expect.poll(async () => (await moves()).length).toBe(1);
  const [move] = await moves();
  expect(move!.value).toBe(resumedStart(startedAt, pausedAt!, move!.at));
  const moved = Date.parse(move!.value) - Date.parse(startedAt);
  expect(moved).toBeGreaterThanOrEqual(1600);
  expect(moved).toBeLessThanOrEqual(2400);
  await expect.poll(async () => (await openSession(page))?.pausedAt ?? null).toBeNull();
});

// The banner's own entries: the ones recorded after the tap.
const after = async (page: Page, from: number) => (await readMotion(page)).slice(from);

test("the banner drops in over 220 ms and leaves in 140 ms; with reduced motion it fades in 120 ms", async ({
  page,
}) => {
  await recordMotion(page);
  await start(page);
  let from = (await readMotion(page)).length;
  await pause(page);
  await expect
    .poll(() => after(page, from))
    .toContainEqual(
      expect.objectContaining({
        target: "div",
        duration: 220,
        easing: OUT,
        transforms: true,
        properties: ["opacity", "transform"],
        kind: "animation",
      }),
    );
  from = (await readMotion(page)).length;
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  // The tag goes at once; the banner fades on its way out.
  await expect(tag(page)).toHaveCount(0);
  await expect
    .poll(() => after(page, from))
    .toContainEqual(
      expect.objectContaining({
        target: "div",
        duration: 140,
        easing: EXIT,
        transforms: false,
        properties: ["opacity"],
        kind: "animation",
      }),
    );
  await expect(banner(page)).toBeHidden();
  // Reduced motion: a fade each way, nothing moves.
  await page.emulateMedia({ reducedMotion: "reduce" });
  from = (await readMotion(page)).length;
  await pause(page);
  await expect
    .poll(() => after(page, from))
    .toContainEqual(
      expect.objectContaining({
        target: "div",
        duration: 120,
        easing: OUT,
        transforms: false,
        properties: ["opacity"],
        kind: "animation",
      }),
    );
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect
    .poll(() => after(page, from))
    .toContainEqual(
      expect.objectContaining({
        target: "div",
        duration: 120,
        easing: EXIT,
        transforms: false,
        properties: ["opacity"],
        kind: "animation",
      }),
    );
  expect((await after(page, from)).filter((m) => m.kind === "animation" && m.transforms)).toEqual(
    [],
  );
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`the paused session has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await start(page);
      await pause(page);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
});
