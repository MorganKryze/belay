import type { Change } from "@belay/shared/sync/schema";
import type { Slot } from "@belay/shared/training/workout";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// Programme on a phone: the row naming the active program and its sheet, the sessions set aside
// under the cards, and on a computer the editor's entry and its preferences in Réglages. Two
// programs on the server besides the starting one, the active one of four sessions, and one
// session set aside.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const T0 = new Date(Date.now() - 20 * 86_400_000).toISOString();
const FORCE = id(0x10);
const SUMMER = id(0x20);
const ASIDE = id(0x19);

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
  {
    kind: "program",
    id: FORCE,
    field: "create",
    name: "Force 4 jours",
    schedule: SCHEDULE,
    at: T0,
  },
  { kind: "program", id: SUMMER, field: "create", name: "Été léger", schedule: SCHEDULE, at: T0 },
  { kind: "activeProgram", programId: FORCE, at: T0 },
  ...session(id(0x11), "Haut lourd", FORCE, 0, ["ds:0025", "ds:0327"]),
  ...session(id(0x12), "Bas lourd", FORCE, 1, ["ds:0043", "ds:0586"]),
  ...session(id(0x13), "Haut léger", FORCE, 2, ["ds:2330", "ds:0031"]),
  ...session(id(0x14), "Bas léger", FORCE, 3, ["ds:0047", "ds:0310"]),
  ...session(ASIDE, "Full body de Léa", null, 0, ["ds:0300", "ds:0160", "ds:0001", "ds:0085"]),
  ...session(id(0x21), "Jambes", SUMMER, 0, ["ds:0739"]),
  ...session(id(0x22), "Dos", SUMMER, 1, ["ds:0085"]),
];

async function open(page: Page, path: string, theme?: "light" | "dark") {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page, { changes: PROGRAMS });
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
}
// The cards' titles, not the section of the sessions set aside.
const titles = (page: Page) =>
  page.getByRole("main").getByRole("heading", { level: 2, name: /^Séance / });
const activeRow = (page: Page, name: string) =>
  page.getByRole("button", { name: new RegExp(`^${name} Programme actif`) });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Programme actif" });
const asideRow = (page: Page) =>
  page.getByRole("region", { name: "De côté · hors rotation" }).getByRole("link");
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const display = (page: Page, text: string) =>
  page.getByText(text, { exact: true }).evaluate((el) => getComputedStyle(el).display);
const FORCE_CARDS = [
  "Séance A · Haut lourd",
  "Séance B · Bas lourd",
  "Séance C · Haut léger",
  "Séance D · Bas léger",
];

for (const width of [390, 360]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("the row opens the sheet, a tap switches the program and the cards change", async ({
      page,
    }) => {
      await open(page, "/workouts?tab=program");
      await expect(titles(page)).toHaveText(FORCE_CARDS);
      await expect(activeRow(page, "Force 4 jours")).toContainText("Programme actif · 4 séances");
      expect(await overflow(page)).toBe(0);
      await activeRow(page, "Force 4 jours").click();
      const choices = sheet(page).getByRole("button", { name: /séances?$/ });
      await expect(choices).toHaveText([
        /^Programme de départ\s*3 séances/,
        /^Force 4 jours\s*4 séances/,
        /^Été léger\s*2 séances/,
      ]);
      await expect(choices.nth(1)).toHaveAttribute("aria-current", "true");
      await expect(sheet(page)).toContainText("Un toucher l'active et ferme.");
      expect(await overflow(page)).toBe(0);
      await choices.nth(2).click();
      await expect(sheet(page)).toBeHidden();
      await expect(titles(page)).toHaveText(["Séance A · Jambes", "Séance B · Dos"]);
      await expect(activeRow(page, "Été léger")).toContainText("Programme actif · 2 séances");
      // No toast says it: the cards are the answer.
      await expect(page.getByRole("status").filter({ hasText: /Été léger/ })).toHaveCount(0);
    });

    test("a De côté row opens its preview, with nothing to start", async ({ page }) => {
      await open(page, "/workouts?tab=program");
      await expect(asideRow(page)).toHaveText(
        /^Full body de Léa\s*4 exercices · environ \d+\u00A0min/,
      );
      expect(await overflow(page)).toBe(0);
      await asideRow(page).click();
      await expect(page).toHaveURL(new RegExp(`/workouts/session/${ASIDE}$`));
      await expect(
        page.getByRole("heading", { level: 1, name: "Full body de Léa", exact: true }),
      ).toBeVisible();
      await expect(page.getByText("De côté · hors rotation", { exact: true })).toBeVisible();
      await expect(page.getByRole("region", { name: "Exercices" }).getByRole("link")).toHaveCount(
        4,
      );
      await expect(page.getByRole("link", { name: /^(Commencer|Reprendre)/ })).toHaveCount(0);
      expect(await overflow(page)).toBe(0);
    });

    test("the note stays and the editor's entry is not drawn", async ({ page }) => {
      await open(page, "/workouts?tab=program");
      await expect(page.getByText("Le programme se modifie sur ordinateur.")).toBeVisible();
      await expect(page.getByRole("link", { name: "Modifier le programme" })).toBeHidden();
    });
  });
}

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the entry row replaces the note and pushes the editor", async ({ page }) => {
    await open(page, "/workouts?tab=program");
    await expect(titles(page)).toHaveText(FORCE_CARDS);
    expect(await display(page, "Le programme se modifie sur ordinateur.")).toBe("none");
    const entry = page.getByRole("link", { name: "Modifier le programme" });
    const box = (await entry.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await overflow(page)).toBe(0);
    await entry.click();
    await expect(page).toHaveURL(/\/workouts\/program$/);
    await expect(page.getByRole("heading", { level: 1, name: "Programme" })).toBeVisible();
  });

  test("Réglages holds the editor's four preferences, kept on the device", async ({ page }) => {
    await open(page, "/settings");
    const group = page.getByRole("region", { name: "Éditeur du programme" });
    await expect(group.getByRole("combobox")).toHaveText([
      /^Repos\s*2\u00A0min 30/,
      /^Vignettes\s*Affichées/,
      /^Aide clavier\s*Toujours/,
      /^Nouvel exercice\s*Valeurs par défaut/,
    ]);
    await group.getByRole("combobox", { name: /^Vignettes/ }).click();
    await page.getByRole("option", { name: "Masquées" }).click();
    await expect(group.getByRole("combobox", { name: "Vignettes · Masquées" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("belay.editorThumbs"))).toBe("hidden");
    expect(await overflow(page)).toBe(0);
  });
});

test("below 1 024 px Réglages has no editor group", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 844 });
  await open(page, "/settings");
  await expect(page.getByRole("region", { name: "Séances" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Éditeur du programme" })).toBeHidden();
});

// One axe run per new state, in each theme.
test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 } });
  for (const theme of ["light", "dark"] as const) {
    test(`Programme with the active row and De côté has no axe violation, ${theme}`, async ({
      page,
    }) => {
      await open(page, "/workouts?tab=program", theme);
      await expect(asideRow(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the program sheet has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, "/workouts?tab=program", theme);
      await activeRow(page, "Force 4 jours").click();
      await expect(sheet(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`a set-aside preview has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, `/workouts/session/${ASIDE}`, theme);
      await expect(page.getByRole("region", { name: "Exercices" })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});

test.describe("accessibility on a computer", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 1280, height: 900 } });
  for (const theme of ["light", "dark"] as const) {
    test(`Réglages' editor group has no axe violation, ${theme}`, async ({ page }) => {
      await open(page, "/settings", theme);
      await expect(page.getByRole("region", { name: "Éditeur du programme" })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});
