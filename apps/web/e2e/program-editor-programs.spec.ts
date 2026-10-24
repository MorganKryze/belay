import type { Change, SyncRequest } from "@belay/shared/sync/schema";
import type { Slot } from "@belay/shared/training/workout";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";

// The programs on a computer: the selector beside the title, its menus, the name in place and the
// delete sheet; then the log sheet of a six-session rotation on a phone. Three programs on the
// server: the starting one, « Force 4 jours » (active, four sessions, B done last) and « Été
// léger ».
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 900 } });

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const T0 = new Date(Date.now() - 20 * 86_400_000).toISOString();
const FORCE = id(0x10);
const SUMMER = id(0x20);
const SIX = id(0x30);

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
  name: string,
  programId: string,
  position: number,
): Change[] => [
  { kind: "programSession", id: sessionId, field: "create", name, programId, position, at: T0 },
  {
    kind: "programSlot",
    id: id(slotIds++),
    field: "create",
    sessionId,
    position: 0,
    rule: null,
    ...slotOf("ds:0025"),
    at: T0,
  },
];
const SCHEDULE = { mode: "rotation" as const, days: Array<null>(7).fill(null) };
const program = (programId: string, name: string): Change => ({
  kind: "program",
  id: programId,
  field: "create",
  name,
  schedule: SCHEDULE,
  at: T0,
});
// Session B of Force done yesterday, recorded with its session: Force offers C next.
const DONE_B: Change[] = (() => {
  const startedAt = new Date(Date.now() - 86_400_000).toISOString();
  const endedAt = new Date(Date.now() - 86_400_000 + 3_600_000).toISOString();
  return [
    {
      kind: "workout",
      id: id(0x900),
      field: "start",
      sessionCode: "B",
      sessionId: id(0x12),
      plan: [slotOf("ds:0025")],
      startedAt,
      at: startedAt,
    },
    { kind: "workout", id: id(0x900), field: "ended", value: endedAt, at: endedAt },
  ];
})();
const PROGRAMS: Change[] = [
  program(FORCE, "Force 4 jours"),
  program(SUMMER, "Été léger"),
  { kind: "activeProgram", programId: FORCE, at: T0 },
  ...session(id(0x11), "Haut lourd", FORCE, 0),
  ...session(id(0x12), "Bas lourd", FORCE, 1),
  ...session(id(0x13), "Haut léger", FORCE, 2),
  ...session(id(0x14), "Bas léger", FORCE, 3),
  ...session(id(0x21), "Jambes", SUMMER, 0),
  ...session(id(0x22), "Dos", SUMMER, 1),
  ...DONE_B,
];

// The server refuses every change sent and, as it does, sends back the row it holds for Force.
async function refuseRename(page: Page) {
  await page.route("**/api/sync", (route) => {
    const request = route.request().postDataJSON() as SyncRequest;
    if (request.changes.length === 0) return route.fallback();
    const empty = { weights: [], measures: [], intake: [], supplements: [], supplementLogs: [] };
    return route.fulfill({
      json: {
        cursor: request.cursor,
        ...empty,
        annotations: [],
        steps: [],
        activities: [],
        workouts: [],
        sets: [],
        target: null,
        profile: null,
        programs: [
          {
            id: FORCE,
            name: "Force 4 jours",
            nameAt: null,
            schedule: SCHEDULE,
            scheduleAt: null,
            removed: false,
            removedAt: null,
          },
        ],
        rejected: request.changes.map((_, index) => ({ index, reason: "refused" })),
        hasMore: false,
      },
    });
  });
}

async function open(page: Page, changes = PROGRAMS, theme?: "light" | "dark") {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page, { changes });
  await page.goto("/workouts/program");
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
}
const selector = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^Programme actif\\s:\\s${name}\\.`) });
const menu = (page: Page) => page.getByRole("menu");
const chips = (page: Page) =>
  page.getByRole("tablist", { name: "Séances du programme" }).getByRole("tab");
const toast = (page: Page, text: RegExp) => page.getByRole("status").filter({ hasText: text });
const nameField = (page: Page) => page.getByRole("textbox", { name: "Nom du programme" });
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const FORCE_CHIPS = [/^A\s*Haut lourd$/, /^B\s*Bas lourd$/, /^C\s*Haut léger$/, /^D\s*Bas léger$/];

test("switching to « Été léger » names its next session, and Annuler brings Force back with C next", async ({
  page,
}) => {
  await open(page);
  await expect(chips(page)).toHaveText(FORCE_CHIPS);
  await selector(page, "Force 4 jours").click();
  await expect(menu(page)).toBeVisible();
  await settled(page);
  expect((await menu(page).boundingBox())!.width).toBe(340);
  const rows = menu(page).getByRole("menuitemradio");
  await expect(rows).toHaveText([
    /^Programme de départ\s*3 séances$/,
    /^Force 4 jours\s*4 séances · actif$/,
    /^Été léger\s*2 séances$/,
  ]);
  await expect(rows.nth(1)).toHaveAttribute("aria-checked", "true");
  await expect(menu(page).getByRole("menuitem", { name: "Supprimer ce programme" })).toHaveCSS(
    "color",
    await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.color = "var(--destructive)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    }),
  );

  await rows.nth(2).click();
  await expect(menu(page)).toBeHidden();
  await expect(chips(page)).toHaveText([/^A\s*Jambes$/, /^B\s*Dos$/]);
  const switched = toast(page, /^Été léger est actif\s:\sla prochaine séance est A · Jambes\./);
  await expect(switched).toBeVisible();
  await expect(selector(page, "Été léger")).toBeVisible();

  await switched.getByRole("button", { name: "Annuler" }).click();
  await expect(chips(page)).toHaveText(FORCE_CHIPS);
  await expect(selector(page, "Force 4 jours")).toBeVisible();
  // Accueil offers the session it offered before the switch.
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByText("Séance C · Haut léger").first()).toBeVisible();
});

test("Vide creates a program of one empty session, active, its name open in the selector", async ({
  page,
}) => {
  await open(page);
  await selector(page, "Force 4 jours").click();
  await menu(page).getByRole("menuitem", { name: "Nouveau programme" }).click();
  await expect(menu(page)).toContainText("Nouveau programme · il devient actif");
  await expect.poll(async () => (await menu(page).boundingBox())?.width).toBe(400);
  await menu(page).getByRole("menuitem", { name: /^Vide/ }).click();
  await expect(nameField(page)).toBeFocused();
  await expect(nameField(page)).toHaveValue("Nouveau programme");
  expect((await nameField(page).boundingBox())!.width).toBe(300);
  await expect(page.getByText("Nom du programme · Entrée enregistre · Échap annule")).toBeVisible();
  await expect(chips(page)).toHaveText(["A"]);
  await expect(toast(page, /^Nouveau programme créé, il est actif\./)).toBeVisible();
  await page.keyboard.type("Bloc d'hiver");
  await page.keyboard.press("Enter");
  await expect(selector(page, "Bloc d'hiver")).toBeVisible();
  expect(await overflow(page)).toBe(0);
});

test("Supprimer asks on the sheet, then Programme de départ becomes active", async ({ page }) => {
  await open(page);
  await selector(page, "Force 4 jours").click();
  await menu(page).getByRole("menuitem", { name: "Supprimer ce programme" }).click();
  const sheet = page.getByRole("dialog", { name: /^Supprimer le programme/ });
  await expect(sheet).toContainText(
    /Ses 4 séances partent avec lui\. Programme de départ redevient actif\. L'historique ne change pas\./,
  );
  await settled(page);
  await sheet.getByRole("button", { name: "Supprimer le programme" }).click();
  await expect(sheet).toBeHidden();
  await expect(selector(page, "Programme de départ")).toBeVisible();
  await expect(chips(page)).toHaveCount(3);
  await selector(page, "Programme de départ").click();
  await expect(menu(page).getByRole("menuitemradio")).toHaveText([
    /^Programme de départ/,
    /^Été léger/,
  ]);
});

test("a rename the server refuses goes back and Accueil shows the refused-entries banner", async ({
  page,
}) => {
  await open(page);
  await refuseRename(page);
  await selector(page, "Force 4 jours").click();
  await menu(page).getByRole("menuitem", { name: "Renommer ce programme" }).click();
  await expect(nameField(page)).toHaveValue("Force 4 jours");
  await nameField(page).fill("Force d'hiver");
  await nameField(page).press("Enter");
  await expect(selector(page, "Force d'hiver")).toBeVisible();
  // The refusal comes back with the sync: the name goes back, and the banner says it where it
  // stands for every refusal.
  await expect(selector(page, "Force 4 jours")).toBeVisible();
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByText("Une saisie a été refusée.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`axe violation, ${theme}`, () => {
    test.use({ reducedMotion: "reduce" });

    test(`programs menu axe violation ${theme}`, async ({ page }) => {
      await open(page, PROGRAMS, theme);
      await selector(page, "Force 4 jours").click();
      await expect(menu(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`new-program menu axe violation ${theme}`, async ({ page }) => {
      await open(page, PROGRAMS, theme);
      await selector(page, "Force 4 jours").click();
      await menu(page).getByRole("menuitem", { name: "Nouveau programme" }).click();
      await expect(menu(page)).toContainText("Vide");
      await expectNoAxeViolations(page);
    });

    test(`rename axe violation ${theme}`, async ({ page }) => {
      await open(page, PROGRAMS, theme);
      await selector(page, "Force 4 jours").click();
      await menu(page).getByRole("menuitem", { name: "Renommer ce programme" }).click();
      await expect(nameField(page)).toBeFocused();
      await expectNoAxeViolations(page);
    });

    test(`delete sheet axe violation ${theme}`, async ({ page }) => {
      await open(page, PROGRAMS, theme);
      await selector(page, "Force 4 jours").click();
      await menu(page).getByRole("menuitem", { name: "Supprimer ce programme" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  // Six sessions, C done last: D comes next.
  const SIX_SESSIONS: Change[] = [
    program(SIX, "Six jours"),
    { kind: "activeProgram", programId: SIX, at: T0 },
    ...["Haut", "Bas", "Dos", "Jambes", "Bras", "Gainage"].flatMap((name, i) =>
      session(id(0x31 + i), name, SIX, i),
    ),
    ...DONE_B.map((c) =>
      c.kind === "workout" && c.field === "start"
        ? { ...c, sessionCode: "C", sessionId: id(0x33) }
        : c,
    ),
  ];

  test("the log sheet of a six-session rotation offers a Séance menu row, the next first, no overflow", async ({
    page,
  }) => {
    await fakeServer(page, { changes: SIX_SESSIONS });
    await page.goto("/workouts?tab=history");
    await expect(page.locator(".launch")).toBeHidden();
    await page.getByRole("button", { name: /^Saisir une séance/ }).click();
    const sheet = page.getByRole("dialog", { name: "Saisir une séance" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radiogroup")).toHaveCount(0);
    const row = sheet.getByRole("combobox", { name: /^Séance · / });
    await expect(row).toHaveAccessibleName("Séance · Séance D · Jambes");
    expect(await overflow(page)).toBe(0);
    await row.click();
    await expect(page.getByRole("option")).toHaveText([
      "Séance D · Jambes",
      "Séance E · Bras",
      "Séance F · Gainage",
      "Séance A · Haut",
      "Séance B · Bas",
      "Séance C · Dos",
    ]);
    expect(await overflow(page)).toBe(0);
    await page.getByRole("option", { name: "Séance F · Gainage" }).click();
    await expect(row).toHaveAccessibleName("Séance · Séance F · Gainage");
  });
});
