import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { ADA, fakeServer } from "./fake-server";
import { readMotion, recordMotion } from "./motion";

// The real clock throughout: the session's time and its end are read against the time that passes.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const SHEET = "cubic-bezier(0.4, 0.2, 0, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";
const SPRING_NAV =
  "linear(0 0%, 0.151 8.3%, 0.435 16.7%, 0.646 25%, 0.788 33.3%, 0.876 41.7%, 0.93 50%, 0.959 58.3%, 0.977 66.7%, 0.986 75%, 0.993 83.3%, 1 100%)";

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
const finishSheet = (page: Page) => page.getByRole("dialog", { name: "Finish the session?" });
const deleteSheet = (page: Page) => page.getByRole("dialog", { name: "Delete the session?" });
const emptySheet = (page: Page) => page.getByRole("dialog", { name: "Nothing logged yet" });
const sessionBar = (page: Page) =>
  page.getByRole("link", { name: /[Ss]et \d+ of \d+ · Session A|Session A In progress/ });
const home = (page: Page) => page.getByRole("heading", { level: 1, name: "Hello, Ada" });

// Session A started on this device; with its cells prefilled from last time when asked.
async function start(page: Page, { prefilled = true } = {}) {
  const server = await fakeServer(page, { changes: prefilled ? LAST_A : [] });
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  if (prefilled) {
    await expect(bench(page).getByRole("textbox", { name: "Load of set 1, kg" })).toHaveValue("80");
    await expect(bench(page).getByRole("textbox", { name: "Reps of set 1" })).toHaveValue("8");
  }
  return server;
}

async function logFirst(page: Page) {
  await bench(page).getByRole("button", { name: "Log set 1" }).click();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
}

async function finish(page: Page) {
  await page.getByRole("button", { name: "Finish", exact: true }).click();
}

// What the device sent and what it still holds to send.
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
  return [...server.requests.flatMap((r) => r.changes), ...queued];
}
const ends = async (page: Page, server: Awaited<ReturnType<typeof fakeServer>>) =>
  (await changes(page, server)).flatMap((c) =>
    c.kind === "workout" && c.id !== LAST && (c.field === "ended" || c.field === "removed")
      ? [c.field]
      : [],
  );

// The entries recorded after a given point.
const after = async (page: Page, from: number) => (await readMotion(page)).slice(from);

test("Finish opens the sheet on the nav spring with its veil, and Finish and save raises the summary", async ({
  page,
}) => {
  await recordMotion(page);
  await start(page);
  await logFirst(page);
  let from = (await readMotion(page)).length;
  await finish(page);
  await expect(finishSheet(page)).toBeVisible();
  await expect(finishSheet(page)).toContainText(
    "1 set logged out of 19. The 18 unticked sets won't be saved; your program doesn't change.",
  );
  await expect(page.getByRole("button", { name: "Keep going" })).toBeFocused();
  await expect
    .poll(() => after(page, from))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: "div[role=dialog][data-state]",
          duration: 500,
          easing: SPRING_NAV,
          kind: "animation",
        }),
        expect.objectContaining({
          target: expect.stringContaining("[data-sheet-overlay]"),
          duration: 350,
          easing: OUT,
          kind: "animation",
        }),
      ]),
    );
  from = (await readMotion(page)).length;
  await finishSheet(page).getByRole("button", { name: "Finish and save" }).click();
  await expect(page.getByText(/^Session done · /)).toBeVisible();
  await expect(page).toHaveURL(/\/workout\/summary\//);
  await expect
    .poll(() => after(page, from))
    .toContainEqual(
      expect.objectContaining({
        target: "::view-transition-new(root)",
        duration: 450,
        easing: SHEET,
        transforms: true,
      }),
    );
});

test("deleting takes two confirmations and leaves no session behind", async ({ page }) => {
  const server = await start(page);
  await logFirst(page);
  await finish(page);
  await finishSheet(page).getByRole("button", { name: "Delete the session…" }).click();
  await expect(deleteSheet(page)).toBeVisible();
  await expect(deleteSheet(page)).toContainText(
    "The logged set won't be kept; your program doesn't change.",
  );
  await expect(page.getByRole("button", { name: "Cancel" })).toBeFocused();
  await expect(finishSheet(page)).toHaveCount(0);
  expect(await ends(page, server)).toEqual([]);
  await deleteSheet(page).getByRole("button", { name: "Delete the session" }).click();
  await expect(home(page)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => ends(page, server)).toEqual(["removed"]);
  await expect(sessionBar(page)).toHaveCount(0);
  await page.goto("/workouts?tab=history");
  // Only Monday's session: the one deleted is in no list.
  await expect(page.getByRole("link", { name: /Session A · Push/ })).toHaveCount(1);
});

test("with nothing logged, Leave without saving lowers the session onto Accueil with no bar", async ({
  page,
}) => {
  await recordMotion(page);
  const server = await start(page, { prefilled: false });
  await finish(page);
  await expect(emptySheet(page)).toBeVisible();
  await expect(emptySheet(page)).toContainText(
    "If you leave, this session won't be kept. You can start it later.",
  );
  await expect(page.getByRole("button", { name: "Keep going" })).toBeFocused();
  const from = (await readMotion(page)).length;
  await emptySheet(page).getByRole("button", { name: "Leave without saving" }).click();
  await expect(home(page)).toBeVisible();
  await expect
    .poll(() => after(page, from))
    .toContainEqual(
      expect.objectContaining({
        target: "::view-transition-old(root)",
        duration: 260,
        easing: EXIT,
        transforms: true,
      }),
    );
  await expect(sessionBar(page)).toHaveCount(0);
  await expect.poll(() => ends(page, server)).toEqual(["removed"]);
});

test("lowering, Back and a reload keep a session with sets open", async ({ page }) => {
  const server = await start(page);
  await logFirst(page);
  await page.getByRole("button", { name: "Minimize the session" }).click();
  await expect(home(page)).toBeVisible();
  await expect(sessionBar(page)).toBeVisible();
  await sessionBar(page).click();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await page.goBack();
  await expect(home(page)).toBeVisible();
  await expect(sessionBar(page)).toBeVisible();
  await sessionBar(page).click();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".launch")).toBeHidden();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeVisible();
  expect(await ends(page, server)).toEqual([]);
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion the sheet slides in 300 ms over a 200 ms veil, and the summary rises in 300 ms", async ({
    page,
  }) => {
    await recordMotion(page);
    await start(page);
    await logFirst(page);
    let from = (await readMotion(page)).length;
    await finish(page);
    await expect(finishSheet(page)).toBeVisible();
    await expect
      .poll(() => after(page, from))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: "div[role=dialog][data-state]",
            duration: 300,
            easing: OUT,
            kind: "animation",
          }),
          expect.objectContaining({
            target: expect.stringContaining("[data-sheet-overlay]"),
            duration: 200,
            easing: OUT,
            kind: "animation",
          }),
        ]),
      );
    from = (await readMotion(page)).length;
    await finishSheet(page).getByRole("button", { name: "Finish and save" }).click();
    await expect(page.getByText(/^Session done · /)).toBeVisible();
    await expect
      .poll(() => after(page, from))
      .toContainEqual(
        expect.objectContaining({
          target: "::view-transition-new(root)",
          duration: 300,
          easing: OUT,
          transforms: true,
        }),
      );
    expect((await readMotion(page)).filter((m) => m.scales)).toEqual([]);
  });

  test("with reduced motion Leave without saving lowers the session in 300 ms", async ({
    page,
  }) => {
    await recordMotion(page);
    await start(page, { prefilled: false });
    await finish(page);
    await expect(emptySheet(page)).toBeVisible();
    const from = (await readMotion(page)).length;
    await emptySheet(page).getByRole("button", { name: "Leave without saving" }).click();
    await expect(home(page)).toBeVisible();
    await expect
      .poll(() => after(page, from))
      .toContainEqual(
        expect.objectContaining({
          target: "::view-transition-old(root)",
          duration: 300,
          easing: OUT,
          transforms: true,
        }),
      );
  });
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  const SHEETS: [string, (page: Page) => Promise<void>][] = [
    [
      "the finish sheet",
      async (page) => {
        await start(page);
        await logFirst(page);
        await finish(page);
        await expect(finishSheet(page)).toBeVisible();
      },
    ],
    [
      "the delete confirmation",
      async (page) => {
        await start(page);
        await logFirst(page);
        await finish(page);
        await finishSheet(page).getByRole("button", { name: "Delete the session…" }).click();
        await expect(deleteSheet(page)).toBeVisible();
      },
    ],
    [
      "the nothing-logged sheet",
      async (page) => {
        await start(page, { prefilled: false });
        await finish(page);
        await expect(emptySheet(page)).toBeVisible();
      },
    ],
  ];
  for (const [name, open] of SHEETS)
    for (const theme of ["light", "dark"] as const) {
      test(`${name} has no axe violation, ${theme}`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
        await open(page);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        await expectNoAxeViolations(page);
      });
    }
});
