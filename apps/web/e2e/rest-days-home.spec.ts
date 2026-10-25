import type { Change } from "@belay/shared/sync/schema";
import type { Slot } from "@belay/shared/training/workout";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";
import { settled } from "./settle";

// Accueil on a program with fixed days, Monday A, Wednesday B, Saturday C, through the week of
// Monday 19 October 2026. The clock is fixed on a Paris morning: nothing on Accueil or a preview
// runs a timer.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 390, height: 844 } });

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const T0 = "2026-10-01T06:00:00.000Z";
const MINE = id(0x10);
const [A, B, C] = [id(0x11), id(0x12), id(0x13)] as const;

const slotOf = (exerciseId: string): Slot => ({
  exerciseId,
  sets: 3,
  repRange: [8, 12],
  rirTarget: [1, 2],
  restSec: 90,
  warmupSets: 0,
  isMain: false,
  groupKey: null,
});
let slotIds = 0x100;
const session = (sessionId: string, name: string, position: number, exercises: string[]) => [
  {
    kind: "programSession",
    id: sessionId,
    field: "create",
    name,
    programId: MINE,
    position,
    at: T0,
  } satisfies Change,
  ...exercises.map((exerciseId, i): Change => ({
    kind: "programSlot",
    id: id(slotIds++),
    field: "create",
    sessionId,
    position: i,
    rule: null,
    ...slotOf(exerciseId),
    at: T0,
  })),
];
const PROGRAM: Change[] = [
  {
    kind: "program",
    id: MINE,
    field: "create",
    name: "Trois jours",
    schedule: { mode: "fixed", days: [A, null, B, null, null, C, null] },
    at: T0,
  },
  { kind: "activeProgram", programId: MINE, at: T0 },
  ...session(A, "Push", 0, ["ds:0025", "ds:0327"]),
  ...session(B, "Legs", 1, ["ds:0043", "ds:0586"]),
  ...session(C, "Tirage", 2, ["ds:2330", "ds:0031"]),
];
// A finished, as another device sent it: Sunday 25 October from 10:00 in Paris, for an hour.
const DONE_A: Change[] = [
  {
    kind: "workout",
    id: id(0x31),
    field: "start",
    sessionCode: "A",
    sessionId: A,
    plan: ["ds:0025", "ds:0327"].map(slotOf),
    startedAt: "2026-10-25T09:00:00.000Z",
    at: "2026-10-25T09:00:00.000Z",
  },
  {
    kind: "workout",
    id: id(0x31),
    field: "ended",
    value: "2026-10-25T10:00:00.000Z",
    at: "2026-10-25T10:00:00.000Z",
  },
];

const TUESDAY = "2026-10-20T07:30:00+02:00";
const WEDNESDAY = "2026-10-21T07:30:00+02:00";
const MONDAY_AFTER = "2026-10-26T07:30:00+01:00";

async function openHome(page: Page, at: string, changes: Change[] = PROGRAM) {
  await page.clock.setFixedTime(new Date(at));
  await fakeServer(page, { changes });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
}
const card = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
const restCard = (page: Page) => card(page, "Jour de repos");
// The kit's colour behind a custom property, as the page computes it.
const colour = (page: Page, name: string, prop = "color") =>
  page.evaluate(
    ([n, p]) => {
      const probe = document.createElement("span");
      probe.style.setProperty(p!, `var(${n})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p!);
      probe.remove();
      return value;
    },
    [name, prop],
  );
const css = (el: Locator, prop: string) =>
  el.evaluate((node, p) => getComputedStyle(node).getPropertyValue(p), prop);
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Tuesday is a rest day: its link pushes B's preview, and back returns to Accueil", async ({
  page,
}) => {
  await openHome(page, TUESDAY);
  const rest = restCard(page);
  await expect(rest).toContainText("Prévu par ton programme");
  const next = rest.getByRole("link", { name: "Demain : Séance B · Legs" });
  await expect(next).toHaveAttribute("href", "/workouts/session/B?from=home");
  await next.click();
  await expect(page.getByRole("heading", { level: 1, name: "Séance B · Legs" })).toBeVisible();
  await settled(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(restCard(page)).toBeVisible();
});

test("Wednesday shows B with « Prévue ce mercredi »", async ({ page }) => {
  await openHome(page, WEDNESDAY);
  const b = card(page, "Séance B · Legs");
  await expect(b).toContainText("Prévue ce mercredi · ");
  await expect(b).not.toContainText("La prochaine");
  await expect(b.getByRole("link", { name: "Voir la séance" })).toHaveAttribute(
    "href",
    "/workouts/session/B?from=home",
  );
});

test("Monday after A done on Sunday shows « Faite hier » and Wednesday's session", async ({
  page,
}) => {
  await openHome(page, MONDAY_AFTER, [...PROGRAM, ...DONE_A]);
  const a = card(page, "Séance A · Push");
  await expect(a).toContainText("Faite hier · ");
  await expect(a.getByRole("link", { name: "Mercredi : Séance B · Legs" })).toHaveAttribute(
    "href",
    "/workouts/session/B?from=home",
  );
});

test("the rest tile is a 36 px track square with a muted leaf, its link 48 px tall", async ({
  page,
}) => {
  await openHome(page, TUESDAY);
  const rest = restCard(page);
  const tile = rest.locator("svg").first().locator("..");
  const box = (await tile.boundingBox())!;
  expect([box.width, box.height]).toEqual([36, 36]);
  expect(await css(tile, "background-color")).toBe(
    await colour(page, "--track", "background-color"),
  );
  expect(await css(tile, "color")).toBe(await colour(page, "--muted-foreground"));
  const link = rest.getByRole("link");
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
});

test("the rest tile on a computer, and nothing overflows at 360, 390 and 1 280 px", async ({
  page,
}) => {
  for (const [at, changes, title] of [
    [TUESDAY, PROGRAM, "Jour de repos"],
    [WEDNESDAY, PROGRAM, "Séance B · Legs"],
    [MONDAY_AFTER, [...PROGRAM, ...DONE_A], "Séance A · Push"],
  ] as const) {
    await openHome(page, at, [...changes]);
    for (const width of [360, 390, 1280]) {
      await page.setViewportSize({ width, height: width < 1024 ? 844 : 800 });
      await expect(card(page, title)).toBeVisible();
      expect(await overflow(page)).toBe(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
  }
  await openHome(page, TUESDAY);
  await page.setViewportSize({ width: 1280, height: 800 });
  const rest = restCard(page);
  await expect(rest.getByRole("link", { name: "Demain : Séance B · Legs" })).toBeVisible();
  const box = (await rest.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
});

for (const theme of ["light", "dark"] as const) {
  test(`Accueil on a rest day has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await openHome(page, TUESDAY);
    await expect(restCard(page)).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`Accueil with « Prévue ce mercredi » has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await openHome(page, WEDNESDAY);
    await expect(card(page, "Séance B · Legs")).toContainText("Prévue ce mercredi");
    await expectNoAxeViolations(page);
  });

  test(`Accueil with « Faite hier » has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await openHome(page, MONDAY_AFTER, [...PROGRAM, ...DONE_A]);
    await expect(card(page, "Séance A · Push")).toContainText("Faite hier");
    await expectNoAxeViolations(page);
  });
}
