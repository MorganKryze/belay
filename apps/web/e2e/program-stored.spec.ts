import type { Change } from "@belay/shared/sync/schema";
import type { Slot } from "@belay/shared/training/workout";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// Programs as the server stores them, end to end: two programs, the active one of five sessions
// (the fifth placed before the fourth) and a session set aside. The real clock throughout: the
// history is placed relative to now.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 390, height: 844 } });

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const DAY = 86_400_000;
const NOW = Date.now();
const T0 = new Date(NOW - 20 * DAY).toISOString(); // the programs written, the first one made active
// A morning on the Paris day n days ago.
const morning = (n: number) => {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(
    new Date(NOW - n * DAY),
  );
  return new Date(`${day}T08:00:00.000Z`);
};

const MINE = id(0x10);
const OTHER = id(0x20);
const S = [id(0x11), id(0x12), id(0x13), id(0x14), id(0x15)] as const;
const ASIDE = id(0x19);
const O = [id(0x21), id(0x22)] as const;

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
const session = (
  sessionId: string,
  name: string | null,
  programId: string | null,
  position: number,
  exercises: string[],
): Change[] => [
  { kind: "programSession", id: sessionId, field: "create", name, programId, position, at: T0 },
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
const SCHEDULE = { mode: "rotation" as const, days: Array<null>(7).fill(null) };
const PROGRAMS: Change[] = [
  { kind: "program", id: MINE, field: "create", name: "Haut / bas", schedule: SCHEDULE, at: T0 },
  { kind: "program", id: OTHER, field: "create", name: "Deux jours", schedule: SCHEDULE, at: T0 },
  { kind: "activeProgram", programId: MINE, at: T0 },
  ...session(S[0], "Haut du corps", MINE, 0, ["ds:0025", "ds:0327"]),
  ...session(S[1], "Bas du corps", MINE, 1, ["ds:0043", "ds:0586"]),
  ...session(S[2], "Tirage", MINE, 2, ["ds:2330", "ds:0031"]),
  // The fifth session made was placed before the fourth, which has no name.
  ...session(S[3], null, MINE, 4, ["ds:0047", "ds:0310"]),
  ...session(S[4], "Dos et abdos", MINE, 3, ["ds:0160", "ds:0001"]),
  ...session(ASIDE, "Partagée par Lou", null, 0, ["ds:0300"]),
  ...session(O[0], "Jambes", OTHER, 0, ["ds:0739"]),
  ...session(O[1], "Dos", OTHER, 1, ["ds:0085"]),
];

// A finished session as another device sent it; with no session id, one started before sessions
// recorded theirs.
const finished = (
  workoutId: string,
  daysAgo: number,
  sessionCode: string,
  exercises: string[],
  sessionId?: string,
): Change[] => {
  const start = morning(daysAgo);
  const startedAt = start.toISOString();
  const endedAt = new Date(start.getTime() + 3_600_000).toISOString();
  return [
    {
      kind: "workout",
      id: workoutId,
      field: "start",
      sessionCode,
      ...(sessionId && { sessionId }),
      plan: exercises.map(slotOf),
      startedAt,
      at: startedAt,
    },
    { kind: "workout", id: workoutId, field: "ended", value: endedAt, at: endedAt },
  ];
};
const DONE_C = id(0x31);
const OLD_A = id(0x32);
const HISTORY: Change[] = [
  ...finished(OLD_A, 5, "A", ["ds:0025"]),
  ...finished(DONE_C, 2, "C", ["ds:2330", "ds:0031"], S[2]),
];

// The rotation reordered on another device: each session's place, written now.
const reorder = (order: readonly string[]): Change[] =>
  order.map((sessionId, position) => ({
    kind: "programSession",
    id: sessionId,
    field: "place",
    programId: MINE,
    position,
    at: new Date().toISOString(),
  }));

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
}
// Coming back online syncs at once: what the fake server holds now reaches the phone.
const syncNow = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event("online")));
const card = (page: Page, title: string) => page.getByRole("region", { name: title, exact: true });
// A session of Programme that is neither next nor open: a link holding its title.
const row = (page: Page, title: string) =>
  page
    .getByRole("main")
    .getByRole("link")
    .filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });
const heading = (page: Page, name: string) =>
  page.getByRole("heading", { level: 1, name, exact: true });
const programTitles = (page: Page) => page.getByRole("main").getByRole("heading", { level: 2 });
const FIVE = [
  "Séance D · Dos et abdos",
  "Séance E",
  "Séance A · Haut du corps",
  "Séance B · Bas du corps",
  "Séance C · Tirage",
];

test("Accueil offers the session after C, lettered by its place", async ({ page }) => {
  await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/");
  const next = card(page, "Séance D · Dos et abdos");
  await expect(next).toContainText("La prochaine");
  await expect(next.getByRole("link", { name: "Voir la séance" })).toHaveAttribute(
    "href",
    "/workouts/session/D?from=home",
  );
});

test("Programme lists the active rotation with letters by position and no set-aside session", async ({
  page,
}) => {
  await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/workouts?tab=program");
  await expect(programTitles(page)).toHaveText(FIVE);
  await expect(row(page, "Séance C · Tirage")).toContainText("Il y a 2 jours");
  await expect(page.getByText("Partagée par Lou")).toHaveCount(0);
});

test("the preview of D shows its exercises, and a letter the rotation lacks is not found", async ({
  page,
}) => {
  await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/workouts/session/D");
  await expect(heading(page, "Séance D · Dos et abdos")).toBeVisible();
  await expect(page.getByRole("region", { name: "Exercices" }).getByRole("link")).toHaveText([
    /^1Cable floor seated wide-grip row/,
    /^23\/4 sit-up/,
  ]);
  for (const path of ["/workouts/session/F", "/workout?start=F"]) {
    await open(page, path);
    await expect(heading(page, "Page introuvable")).toBeVisible();
  }
});

test("switching the active program through the fake server shows the other rotation from A", async ({
  page,
}) => {
  const server = await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/");
  await expect(card(page, "Séance D · Dos et abdos")).toBeVisible();
  server.push({ kind: "activeProgram", programId: OTHER, at: new Date().toISOString() });
  await syncNow(page);
  await expect(card(page, "Séance A · Jambes")).toContainText("La prochaine");
  await open(page, "/workouts?tab=program");
  await expect(programTitles(page)).toHaveText(["Séance A · Jambes", "Séance B · Dos"]);
});

test("starting E then reordering keeps the open session", async ({ page }) => {
  const server = await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/workouts/session/E");
  await expect(heading(page, "Séance E")).toBeVisible();
  await page.getByRole("link", { name: "Commencer la séance" }).click();
  await expect(page).toHaveURL(/\/workout$/);
  await expect(heading(page, "Séance E")).toBeVisible();
  // The start records the session it came from.
  await expect
    .poll(() =>
      server.requests
        .flatMap((r) => r.changes)
        .flatMap((c) =>
          c.kind === "workout" && c.field === "start" ? [[c.sessionCode, c.sessionId]] : [],
        ),
    )
    .toEqual([["E", S[3]]]);
  // E moves first on another device.
  server.push(...reorder([S[3], S[0], S[1], S[2], S[4]]));
  await syncNow(page);
  await open(page, "/workouts?tab=program");
  // The next session first (after C, now D: E), then the rotation's order from there.
  await expect(programTitles(page)).toHaveText([
    "Séance E · Dos et abdos",
    "Séance A",
    "Séance B · Haut du corps",
    "Séance C · Bas du corps",
    "Séance D · Tirage",
  ]);
  // The open session is the one now at A, under the letter it was started with.
  await expect(card(page, "Séance A")).toContainText("En cours");
  await open(page, "/");
  await expect(card(page, "Séance E")).toContainText("En cours");
  await open(page, "/workout");
  await expect(heading(page, "Séance E")).toBeVisible();
  await expect(page.getByRole("region", { name: /^Barbell incline bench press/ })).toBeVisible();
});

test("a past session keeps its letter and title after a reorder", async ({ page }) => {
  const server = await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, `/workouts/${DONE_C}`);
  await expect(heading(page, "Séance C · Tirage")).toBeVisible();
  // Tirage moves first: the next session is now B.
  server.push(...reorder([S[2], S[0], S[1], S[4], S[3]]));
  await syncNow(page);
  await open(page, "/workouts?tab=program");
  await expect(programTitles(page).first()).toHaveText("Séance B · Haut du corps");
  await expect(row(page, "Séance A · Tirage")).toContainText("Il y a 2 jours");
  await open(page, `/workouts/${DONE_C}`);
  await expect(heading(page, "Séance C · Tirage")).toBeVisible();
  await open(page, "/workouts/session/A");
  await expect(page.getByText(/^La dernière fois/)).toBeVisible();
  // Renamed since, it shows its current name; one recorded before sessions kept their id is named
  // after its letter's starting session.
  server.push({
    kind: "programSession",
    id: S[2],
    field: "name",
    value: "Tirage lourd",
    at: new Date().toISOString(),
  });
  await syncNow(page);
  await expect(heading(page, "Séance A · Tirage lourd")).toBeVisible();
  await open(page, "/workouts?tab=history");
  await expect(page.getByRole("region", { name: "Récentes" }).getByRole("link")).toHaveText([
    /Séance C · Tirage lourd$/,
    /Séance A · Push$/,
  ]);
});

test("« Saisir une séance » offers the rotation, next first", async ({ page }) => {
  await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/workouts?tab=history");
  await expect(page.getByRole("region", { name: "Récentes" }).getByRole("link").first()).toHaveText(
    /Séance C · Tirage$/,
  );
  await page.getByRole("button", { name: /^Saisir une séance/ }).click();
  const sheet = page.getByRole("dialog", { name: "Saisir une séance" });
  await expect(sheet.getByRole("radio")).toHaveText(["A", "B", "C", "D", "E"]);
  await expect(sheet.getByRole("radio", { name: "D" })).toBeChecked();
  await expect(sheet.getByText("Séance D · Dos et abdos", { exact: true })).toBeVisible();
  await sheet.getByRole("radio", { name: "E" }).click();
  await expect(sheet.getByText("Séance E", { exact: true })).toBeVisible();
  await sheet.getByRole("button", { name: "Saisir les séries" }).click();
  await expect(heading(page, "Séance E")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Barbell incline bench press/ })).toBeVisible();
});

test("the library filter lists the rotation's exercises, the exercise page names its sessions", async ({
  page,
}) => {
  await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/workouts?tab=exercises");
  await expect(page.getByRole("heading", { name: "Dans ton programme" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("list").first().getByRole("link")).toHaveText([
    /^Barbell bench press/,
    /^Dumbbell incline row/,
    /^Barbell full squat/,
    /^Lever lying leg curl/,
    /^Cable lat pulldown/,
    /^Barbell curl/,
    /^Cable floor seated wide-grip row/,
    /^3\/4 sit-up/,
    /^Barbell incline bench press/,
    /^Dumbbell front raise/,
  ]);
  await open(page, "/exercises/ds:0160");
  await expect(page.getByRole("link", { name: /^Séance D · Dos et abdos/ })).toBeVisible();
  await open(page, "/exercises/ds:0300");
  await expect(page.getByText("Partagée par Lou", { exact: true })).toBeVisible();
});

test("no active program shows no card", async ({ page }) => {
  const server = await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
  await open(page, "/");
  await expect(card(page, "Séance D · Dos et abdos")).toBeVisible();
  // The active program removed on another device.
  server.push({
    kind: "program",
    id: MINE,
    field: "removed",
    value: true,
    at: new Date().toISOString(),
  });
  await syncNow(page);
  await expect(page.getByRole("region", { name: /^Séance / })).toHaveCount(0);
  await open(page, "/workouts?tab=program");
  await expect(page.getByText("Le programme se modifie sur ordinateur.")).toBeVisible();
  await expect(programTitles(page)).toHaveCount(0);
});

// One axe run per new state, in each theme.
const STATES: [string, (page: Page) => Promise<void>][] = [
  [
    "Programme with a rotation of five",
    async (page) => {
      await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
      await open(page, "/workouts?tab=program");
      await expect(programTitles(page)).toHaveText(FIVE);
    },
  ],
  [
    "the preview of a session lettered D",
    async (page) => {
      await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
      await open(page, "/workouts/session/D");
      await expect(heading(page, "Séance D · Dos et abdos")).toBeVisible();
    },
  ],
  [
    "the log sheet over a rotation of five",
    async (page) => {
      await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY] });
      await open(page, "/workouts?tab=history");
      await expect(
        page.getByRole("region", { name: "Récentes" }).getByRole("link").first(),
      ).toHaveText(/Séance C · Tirage$/);
      await page.getByRole("button", { name: /^Saisir une séance/ }).click();
      await expect(page.getByRole("dialog").getByRole("radio")).toHaveCount(5);
    },
  ],
  [
    "Accueil with no active program",
    async (page) => {
      const removed: Change = { kind: "program", id: MINE, field: "removed", value: true, at: T0 };
      await fakeServer(page, { changes: [...PROGRAMS, ...HISTORY, removed] });
      await open(page, "/workouts?tab=history");
      await expect(
        page.getByRole("region", { name: "Récentes" }).getByRole("link").first(),
      ).toHaveText(/Séance C · Tirage$/);
      await open(page, "/");
      await expect(page.getByRole("region", { name: /^Séance / })).toHaveCount(0);
    },
  ],
];
for (const theme of ["light", "dark"] as const) {
  for (const [name, arrange] of STATES) {
    test(`${name} has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await arrange(page);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
}
