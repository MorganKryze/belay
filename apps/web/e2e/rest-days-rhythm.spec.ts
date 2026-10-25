import type { Change } from "@belay/shared/sync/schema";
import type { Schedule } from "@belay/shared/training/stored-program";
import type { Slot } from "@belay/shared/training/workout";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { ADA, fakeServer } from "./fake-server";

// The program's rhythm on Programme: the « Rythme » row and its sheet, from rotation to fixed
// days proposed from the last four weeks. Sunday 25 October 2026, 8 a.m. in Paris; no timer runs
// on these screens, so the clock stays fixed.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-25T08:00:00+01:00"));
});

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const T0 = "2026-09-01T08:00:00.000Z";
const MINE = id(0x10);
const S = [id(0x11), id(0x12), id(0x13), id(0x14), id(0x15)] as const;
const NAMES = ["Push", "Legs", "Fessiers + tirage léger", "Bras", "Mollets"];

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
const EXERCISES = ["ds:0025", "ds:0043", "ds:2330", "ds:0047", "ds:0160"];
const ROTATION: Schedule = { mode: "rotation", days: Array<null>(7).fill(null) };
// The active program of `count` sessions with its schedule, as the server stores it.
const program = (count: number, schedule: Schedule = ROTATION): Change[] => [
  { kind: "program", id: MINE, field: "create", name: "Ma semaine", schedule, at: T0 },
  { kind: "activeProgram", programId: MINE, at: T0 },
  ...S.slice(0, count).flatMap((sessionId, i): Change[] => [
    {
      kind: "programSession",
      id: sessionId,
      field: "create",
      name: NAMES[i]!,
      programId: MINE,
      position: i,
      at: T0,
    },
    {
      kind: "programSlot",
      id: id(0x100 + i),
      field: "create",
      sessionId,
      position: 0,
      rule: null,
      ...slotOf(EXERCISES[i]!),
      at: T0,
    },
  ]),
];
// Four weeks of A on Mondays, B on Wednesdays, C on Fridays, at 6 p.m. in Paris.
const HISTORY: Change[] = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"].flatMap(
  (monday, w) =>
    [0, 1, 2].flatMap((k): Change[] => {
      const day = new Date(Date.parse(`${monday}T16:00:00Z`) + 2 * k * 86_400_000);
      const workout = id(0x200 + w * 3 + k);
      const startedAt = day.toISOString();
      const endedAt = new Date(day.getTime() + 3_600_000).toISOString();
      return [
        {
          kind: "workout",
          id: workout,
          field: "start",
          sessionCode: "ABC"[k]!,
          sessionId: S[k],
          plan: [slotOf(EXERCISES[k]!)],
          startedAt,
          at: startedAt,
        },
        { kind: "workout", id: workout, field: "ended", value: endedAt, at: endedAt },
      ];
    }),
);

async function open(page: Page, changes: Change[], theme?: "light" | "dark") {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  const server = await fakeServer(page, { changes });
  await page.goto("/workouts?tab=program");
  await expect(page.locator(".launch")).toBeHidden();
  // The phone first draws its own starter program; nothing is checked before the server's lands.
  await expect(page.getByRole("button", { name: /^Ma semaine / })).toBeVisible();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
  return server;
}
// What the outbox still holds.
const queued = (page: Page) =>
  page.evaluate(
    (account) =>
      new Promise<Change[]>((resolve, reject) => {
        const db = indexedDB.open(`belay.${account}`);
        db.onerror = () => reject(db.error);
        db.onsuccess = () => {
          const all = db.result.transaction("outbox").objectStore("outbox").getAll();
          all.onsuccess = () => {
            db.result.close();
            resolve((all.result as { change: Change }[]).map((e) => e.change));
          };
        };
      }),
    ADA.id,
  );
const row = (page: Page) => page.getByRole("button", { name: /^Rythme / });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Rythme du programme" });
const day = (page: Page, name: string) => sheet(page).getByRole("radiogroup", { name });
const DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
// Programme's cards: their titles in order, and each one's line under its title.
const titles = (page: Page) => page.getByRole("heading", { level: 2, name: /^Séance / });
const lines = (page: Page) =>
  titles(page).evaluateAll((hs) => hs.map((h) => h.nextElementSibling?.textContent ?? ""));
const TITLES = [
  "Séance A · Push",
  "Séance B · Legs",
  "Séance C · Fessiers + tirage léger",
] as const;
const FIXED: Schedule = { mode: "fixed", days: [S[0], null, S[1], null, null, S[2], null] };
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Whether an element shows its whole text: nothing cut across nor clamped down.
const whole = (page: Page, text: string) =>
  page
    .getByText(text, { exact: true })
    .evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);

test("Jours fixes proposed from the last weeks, Friday on Repos and Saturday C, saved in one change", async ({
  page,
}) => {
  const server = await open(page, [...program(3), ...HISTORY]);
  await expect(row(page)).toHaveText(/^Rythme\s*A, B, C à la suite\s*En rotation$/);
  await row(page).click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("radio", { name: "En rotation" })).toBeChecked();
  await sheet(page).getByRole("radio", { name: "Jours fixes" }).click();
  await expect(
    sheet(page).getByText("Proposé d'après tes dernières semaines. Un tap change un jour."),
  ).toBeVisible();
  const picked = ["A", "Repos", "B", "Repos", "C", "Repos", "Repos"];
  for (const [i, name] of DAYS.entries())
    await expect(day(page, name).getByRole("radio", { name: picked[i] })).toBeChecked();
  await expect(
    sheet(page).getByText("A · Push, B · Legs, C · Fessiers + tirage léger"),
  ).toBeVisible();
  await day(page, "Vendredi").getByRole("radio", { name: "Repos" }).click();
  await day(page, "Samedi").getByRole("radio", { name: "C" }).click();
  await sheet(page).getByRole("button", { name: "Enregistrer" }).click();
  await expect(sheet(page)).toBeHidden();
  await expect(row(page)).toHaveText(/^Rythme\s*3 séances par semaine\s*Jours fixes$/);
  const schedule = async () =>
    [...server.requests.flatMap((r) => r.changes), ...(await queued(page))].filter(
      (c) => c.kind === "program" && c.field === "schedule",
    );
  await expect.poll(async () => (await schedule()).length).toBe(1);
  expect((await schedule())[0]).toMatchObject({
    kind: "program",
    id: MINE,
    field: "schedule",
    value: { mode: "fixed", days: [S[0], null, S[1], null, null, S[2], null] },
  });
  // The cards now follow the week from this Sunday: A tomorrow, then B and C on their days.
  await expect(titles(page)).toHaveText(TITLES);
  expect(await lines(page)).toEqual([
    "Demain, lundi · 1 exercice · environ 5\u00A0min",
    "Mercredi · 1 exercice · environ 5\u00A0min",
    "Samedi · 1 exercice · environ 5\u00A0min",
  ]);
  const a = page.getByRole("region", { name: TITLES[0] });
  await expect(a.getByRole("link", { name: "Voir la séance" })).toBeVisible();
  // The days in bold, in the title's ink; the rest of the line stays muted.
  expect(
    await page.getByRole("link", { name: /^Séance B/ }).evaluate((card) => {
      const days = getComputedStyle(card.querySelector("b")!);
      const title = getComputedStyle(card.querySelector("h2")!);
      const line = getComputedStyle(card.querySelector("p")!);
      return [
        Number(days.fontWeight) >= 600,
        days.color === title.color,
        line.color !== title.color,
      ];
    }),
  ).toEqual([true, true, true]);
  // On Tuesday, a rest day, Accueil and Programme name the same next session: B on Wednesday.
  await page.clock.setFixedTime(new Date("2026-10-27T08:00:00+01:00"));
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("link", { name: "Demain : Séance B · Legs" })).toBeVisible();
  await page.goto("/workouts?tab=program");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(titles(page).first()).toHaveText(TITLES[1]);
  expect((await lines(page))[0]).toMatch(/^Demain, mercredi · /);
});

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  // Decision 1: the value stays on the label's line at the right, the count on a second line,
  // from 1 to 6 days, in both themes.
  const week = [S[0], S[1], S[2], S[0], S[1], S[2], null];
  for (const theme of ["light", "dark"] as const)
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const count = n === 1 ? "1 séance par semaine" : `${n} séances par semaine`;
      test(`${count}: Jours fixes beside Rythme, the count under it, ${theme}`, async ({
        page,
      }) => {
        const days = week.map((d, i) => (i < n ? d : null));
        await open(page, program(3, { mode: "fixed", days }), theme);
        await expect(row(page)).toHaveText(new RegExp(`^Rythme\\s*${count}\\s*Jours fixes$`));
        const box = async (text: string) =>
          (await row(page).getByText(text, { exact: true }).boundingBox())!;
        const [label, sub, value, r] = [
          await box("Rythme"),
          await box(count),
          await box("Jours fixes"),
          (await row(page).boundingBox())!,
        ];
        // The value on the label's line, at the right of the row, on one line.
        expect(Math.abs(value.y - label.y)).toBeLessThanOrEqual(2);
        expect(value.height).toBeLessThanOrEqual(label.height + 2);
        expect(value.x).toBeGreaterThan(label.x + label.width);
        expect(r.x + r.width - (value.x + value.width)).toBeLessThan(48);
        // The count alone on the second line: two lines in all.
        expect(sub.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
        expect(sub.height).toBeLessThan(label.height + 2);
        expect(sub.y + sub.height).toBeLessThanOrEqual(r.y + r.height);
        for (const text of ["Rythme", count, "Jours fixes"])
          expect(await whole(page, text)).toBe(true);
        expect(await overflow(page)).toBe(0);
      });
    }

  test("the chips fit, 44 px each, and arrows move between a day's chips", async ({ page }) => {
    await open(
      page,
      program(3, { mode: "fixed", days: [S[0], null, S[1], null, S[2], null, null] }),
    );
    await row(page).click();
    await expect(day(page, "Mercredi")).toBeVisible();
    // Measured once the sheet has risen: mid-slide a chip sits between pixels and reads 43.9999.
    await settled(page);
    for (const chip of await sheet(page).getByRole("radio").all()) {
      const box = (await chip.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    const panel = await sheet(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(panel).toBe(0);
    expect(await overflow(page)).toBe(0);
    await day(page, "Lundi").getByRole("radio", { name: "A" }).focus();
    // Radix picks the chip an arrow focuses only while the key is down; a press would release it
    // before the focus moves.
    await page.keyboard.down("ArrowRight");
    await expect(day(page, "Lundi").getByRole("radio", { name: "B" })).toBeFocused();
    await expect(day(page, "Lundi").getByRole("radio", { name: "B" })).toBeChecked();
    await page.keyboard.up("ArrowRight");
  });

  test("with 5 sessions each day is a menu row, nothing overflows", async ({ page }) => {
    await open(
      page,
      program(5, { mode: "fixed", days: [S[0], null, S[3], null, S[4], null, null] }),
    );
    await row(page).click();
    const rows = sheet(page).getByRole("combobox");
    await expect(rows).toHaveCount(7);
    await expect(rows.nth(2)).toHaveAccessibleName("Mercredi · D · Bras");
    await expect(sheet(page).getByRole("radiogroup", { name: "Lundi" })).toHaveCount(0);
    const panel = await sheet(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(panel).toBe(0);
    expect(await overflow(page)).toBe(0);
    await rows.nth(1).click();
    await expect(page.getByRole("option")).toHaveText([
      "Repos",
      "A · Push",
      "B · Legs",
      "C · Fessiers + tirage léger",
      "D · Bras",
      "E · Mollets",
    ]);
    await page.getByRole("option", { name: "E · Mollets" }).click();
    await expect(rows.nth(1)).toHaveAccessibleName("Mardi · E · Mollets");
  });
});

test("on a phone the note follows the row, and the editor's entry is not drawn", async ({
  page,
}) => {
  await open(page, program(3));
  const rowBox = (await row(page).boundingBox())!;
  const noteBox = (await page
    .getByText("Les exercices du programme se modifient sur ordinateur.")
    .boundingBox())!;
  expect(noteBox.y).toBeGreaterThanOrEqual(rowBox.y + rowBox.height);
  await expect(page.getByRole("link", { name: /^Modifier le programme/ })).toBeHidden();
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("« Rythme » and « Modifier le programme » share one group", async ({ page }) => {
    await open(page, program(3));
    const entry = page.getByRole("link", { name: /^Modifier le programme / });
    await expect(entry).toBeVisible();
    // The entry dressed as the row above: its icon square, then « séances, exercices, séries »
    // under its label, in the same muted ink as the count under « Rythme ».
    const [icon, rowIcon] = [
      (await entry.locator("[data-slot=row-icon]").boundingBox())!,
      (await row(page).locator("[data-slot=row-icon]").boundingBox())!,
    ];
    expect([icon.x, icon.width, icon.height]).toEqual([rowIcon.x, rowIcon.width, rowIcon.height]);
    const label = (await entry.getByText("Modifier le programme", { exact: true }).boundingBox())!;
    const sub = entry.getByText("séances, exercices, séries", { exact: true });
    const subBox = (await sub.boundingBox())!;
    expect(subBox.x).toBe(label.x);
    expect(subBox.y).toBeGreaterThanOrEqual(label.y + label.height - 1);
    const ink = (el: Element) => getComputedStyle(el).color;
    expect(await sub.evaluate(ink)).toBe(
      await row(page).getByText("A, B, C à la suite", { exact: true }).evaluate(ink),
    );
    await expect(
      page.getByText("Les exercices du programme se modifient sur ordinateur."),
    ).toBeHidden();
    const r = (await row(page).boundingBox())!;
    const e = (await entry.boundingBox())!;
    // One card: the same column, the entry right under the row past a 1 px hairline.
    expect(e.x).toBe(r.x);
    expect(e.width).toBe(r.width);
    expect(e.y - (r.y + r.height)).toBeCloseTo(1, 0);
    const cards = await row(page).evaluate(
      (el, link) => el.parentElement === link?.parentElement?.parentElement,
      await entry.elementHandle(),
    );
    expect(cards).toBe(true);
    expect(await overflow(page)).toBe(0);
  });
});

// One axe run per new state, in each theme.
test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`Programme with the rhythm row has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, program(3), theme);
      await expect(row(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the rhythm sheet in rotation has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, program(3), theme);
      await row(page).click();
      await expect(sheet(page).getByText(/^Les séances s'enchaînent/)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the rhythm sheet on fixed days has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, [...program(3), ...HISTORY], theme);
      await row(page).click();
      await sheet(page).getByRole("radio", { name: "Jours fixes" }).click();
      await expect(day(page, "Dimanche")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the rhythm sheet with menu rows has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, program(5), theme);
      await row(page).click();
      await sheet(page).getByRole("radio", { name: "Jours fixes" }).click();
      await expect(sheet(page).getByRole("combobox")).toHaveCount(7);
      await expectNoAxeViolations(page);
    });
  }
});

// Programme on fixed days: the cards in the week's order, each with its day.
test.describe("Programme's cards on fixed days", () => {
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`Programme on fixed days has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, program(3, FIXED), theme);
      await expect(titles(page)).toHaveText(TITLES);
      await expectNoAxeViolations(page);
    });
  }

  test.describe("on a computer", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test("the cards and the rhythm group share one column, nothing overflows", async ({ page }) => {
      await open(page, program(3, FIXED));
      await expect(titles(page)).toHaveText(TITLES);
      expect((await lines(page))[0]).toMatch(/^Demain, lundi · /);
      const card = (await page.getByRole("region", { name: TITLES[0] }).boundingBox())!;
      const r = (await row(page).boundingBox())!;
      expect(r.x).toBe(card.x);
      expect(r.width).toBe(card.width);
      expect(await overflow(page)).toBe(0);
    });
  });
});
