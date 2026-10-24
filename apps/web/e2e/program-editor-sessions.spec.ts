import type { Change } from "@belay/shared/sync/schema";
import type { Slot } from "@belay/shared/training/workout";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer, refuseChanges } from "./fake-server";

// The sessions of a program on a computer: « + Séance », the name in place, the session's menu,
// setting aside and putting back, the empty session. The starting program as a new account holds
// it, or « Force 4 jours » from the server: Haut lourd, Bas lourd, Haut léger, Bas léger.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 900 } });

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const T0 = new Date(Date.now() - 20 * 86_400_000).toISOString();
const FORCE = id(0x10);
const SCHEDULE = { mode: "rotation" as const, days: Array<null>(7).fill(null) };

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
const force = (extra: Change[] = []): Change[] => [
  {
    kind: "program",
    id: FORCE,
    field: "create",
    name: "Force 4 jours",
    schedule: SCHEDULE,
    at: T0,
  },
  { kind: "activeProgram", programId: FORCE, at: T0 },
  ...session(id(0x11), "Haut lourd", FORCE, 0),
  ...session(id(0x12), "Bas lourd", FORCE, 1),
  ...session(id(0x13), "Haut léger", FORCE, 2),
  ...session(id(0x14), "Bas léger", FORCE, 3),
  ...extra,
];
// Seven sessions in Force, then one alone in a program of its own.
const SEVEN = force([
  ...session(id(0x15), "Gainage", FORCE, 4),
  ...session(id(0x16), "Bras", FORCE, 5),
  ...session(id(0x17), "Mobilité", FORCE, 6),
]);
const ONE: Change[] = [
  { kind: "program", id: id(0x20), field: "create", name: "Été", schedule: SCHEDULE, at: T0 },
  { kind: "activeProgram", programId: id(0x20), at: T0 },
  ...session(id(0x21), "Tout le corps", id(0x20), 0),
];
// The starting program with six more sessions, nine in all.
const NINE: Change[] = [
  "Bras",
  "Haut du corps",
  "Bas du corps",
  "Gainage",
  "Dos",
  "Mobilité",
].flatMap((name, i) => session(id(0x30 + i), name, "00000000-0000-7000-8000-000000000010", 3 + i));

async function open(page: Page, changes: Change[] = [], theme?: "light" | "dark") {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  const server = await fakeServer(page, { changes });
  await page.goto("/workouts/program");
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  return server;
}
const chips = (page: Page) => page.getByRole("tablist", { name: "Séances du programme" });
const chip = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });
const add = (page: Page) => page.getByRole("button", { name: "Ajouter une séance" });
const title = (page: Page) => page.getByRole("heading", { level: 2 });
const search = (page: Page) => page.getByRole("combobox", { name: "Ajouter un exercice" });
const nameField = (page: Page) => page.getByRole("textbox", { name: "Nom de la séance" });
const more = (page: Page) => page.getByRole("button", { name: "Autres actions sur la séance" });
const menu = (page: Page) => page.getByRole("menu");
const toast = (page: Page) => page.locator("[role=status]").filter({ hasText: /\S/ }).last();
const rows = (page: Page) => page.getByRole("grid").locator("[data-row]");
// Spaces as a reader sees them: the narrow and no-break ones read as plain spaces.
const plain = (text: string | null) => (text ?? "").replace(/\s/g, " ");
const tabNames = (page: Page) =>
  chips(page)
    .getByRole("tab")
    .evaluateAll((tabs) => tabs.map((t) => t.getAttribute("aria-label") ?? t.textContent));

test("+ Séance, a name, two exercises, then Supprimer and Annuler bring D back", async ({
  page,
}) => {
  await open(page);
  await add(page).click();
  await expect(chip(page, "D")).toHaveAttribute("aria-selected", "true");
  await expect(title(page)).toHaveText("Séance D");
  await expect(search(page)).toBeFocused();
  await expect(page.getByText("pars d'une séance existante")).toBeVisible();

  await page.getByRole("button", { name: "Renommer la séance" }).click();
  await expect(nameField(page)).toBeFocused();
  await expect(page.getByText("Séance D ·", { exact: true })).toBeVisible();
  await page.keyboard.type("Bras");
  await expect(nameField(page)).toHaveValue("Bras");
  await page.keyboard.press("Enter");
  await expect(chip(page, "D · Bras")).toBeVisible();
  await expect(title(page)).toHaveText("Séance D · Bras");

  for (const query of ["curl", "push"]) {
    await search(page).click();
    await page.keyboard.type(query);
    await expect(search(page)).toHaveValue(query);
    await page.keyboard.press("Enter");
    await expect(search(page)).toHaveValue("");
  }
  await expect(rows(page)).toHaveCount(2);
  const size = page.getByText(/^2 exercices · /);
  await expect
    .poll(async () => plain(await size.textContent()))
    .toBe("2 exercices · 6 séries · environ 15 min");
  const exercises = await rows(page).evaluateAll((r) =>
    r.map((x) => x.querySelector(".truncate")?.textContent),
  );

  await more(page).click();
  await menu(page).getByRole("menuitem", { name: "Supprimer la séance D" }).click();
  await expect(title(page)).toHaveText("Séance C · Fessiers + tirage léger");
  expect(await tabNames(page)).toEqual(["A · Push", "B · Legs", "C · Fessiers + tirage léger"]);
  await expect(toast(page)).toContainText("Séance D · Bras supprimée.");
  await toast(page).getByRole("button", { name: "Annuler" }).click();
  await expect(title(page)).toHaveText("Séance D · Bras");
  await expect(rows(page)).toHaveCount(2);
  expect(
    await rows(page).evaluateAll((r) => r.map((x) => x.querySelector(".truncate")?.textContent)),
  ).toEqual(exercises);
});

test("Mettre de côté says the letter that moves, Remettre dans la rotation puts it back as D", async ({
  page,
}) => {
  await open(page, force());
  await chip(page, "C · Haut léger").click();
  await expect(title(page)).toHaveText("Séance C · Haut léger");
  await more(page).click();
  await menu(page)
    .getByRole("menuitem", { name: /^Mettre de côté/ })
    .click();
  await expect(toast(page)).toHaveText(/Haut léger mise de côté\. D devient C\./);
  expect(await tabNames(page)).toEqual(["A · Haut lourd", "B · Bas lourd", "C · Bas léger"]);
  const aside = page.getByRole("tablist", { name: "De côté" });
  await expect(aside.getByRole("tab")).toHaveText(["Haut léger"]);
  await expect(title(page)).toHaveText("Haut léger");
  // The set-aside chip is outlined, without a fill.
  const outlined = await aside
    .getByRole("tab")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(outlined).not.toBe(
    await chip(page, "A · Haut lourd").evaluate((el) => getComputedStyle(el).backgroundColor),
  );

  await page.getByRole("button", { name: "Remettre dans la rotation" }).click();
  await expect(chip(page, "D · Haut léger")).toBeVisible();
  await expect(title(page)).toHaveText("Séance D · Haut léger");
  await expect(toast(page)).toContainText("Haut léger remise dans la rotation, en D.");
  await expect(page.getByRole("tablist", { name: "De côté" })).toHaveCount(0);
});

test("a chip dragged before another takes its letter, said in words", async ({ page }) => {
  await open(page, force());
  const from = (await chip(page, "D · Bas léger").boundingBox())!;
  const to = (await chip(page, "B · Bas lourd").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 8, to.y + to.height / 2, { steps: 12 });
  // While it moves, the lifted chip already shows its future letter.
  await expect(chip(page, "B · Bas léger")).toBeVisible();
  await page.mouse.up();
  await expect
    .poll(() => tabNames(page))
    .toEqual(["A · Haut lourd", "B · Bas léger", "C · Bas lourd", "D · Haut léger"]);
  await expect(page.locator('p[aria-live="polite"]')).toHaveText(
    /Bas léger devient B\s; Bas lourd devient C\s; Haut léger devient D/,
  );
});

test("nine sessions wrap and « + Séance » stays last", async ({ page }) => {
  await open(page, NINE);
  await expect(chips(page).getByRole("tab")).toHaveCount(9);
  const tops = await chips(page)
    .getByRole("tab")
    .evaluateAll((tabs) => tabs.map((t) => t.getBoundingClientRect().top));
  expect(new Set(tops).size).toBeGreaterThan(1);
  const last = (await chips(page).getByRole("tab").last().boundingBox())!;
  const plus = (await add(page).boundingBox())!;
  expect(plus.y > last.y + 1 || (Math.abs(plus.y - last.y) < 1 && plus.x > last.x)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("a session rename the server refuses goes back, with the banner on the editor", async ({
  page,
}) => {
  const server = await open(page, force());
  await refuseChanges(page, "refused", server);
  await page.getByRole("button", { name: "Renommer la séance" }).click();
  await expect(nameField(page)).toHaveValue("Haut lourd");
  await nameField(page).fill("Haut d'hiver");
  await page.keyboard.press("Enter");
  await expect(title(page)).toHaveText("Séance A · Haut d'hiver");
  await expect(title(page)).toHaveText("Séance A · Haut lourd");
  await expect(page.getByText("Une saisie a été refusée.")).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test.describe(`axe violation, ${theme}`, () => {
    test.use({ reducedMotion: "reduce" });

    test(`chips with De côté axe violation ${theme}`, async ({ page }) => {
      await open(page, force(session(id(0x40), "Full body de Léa", null, 0)), theme);
      await expect(page.getByRole("tablist", { name: "De côté" })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`session menu with 7 sessions axe violation ${theme}`, async ({ page }) => {
      await open(page, SEVEN, theme);
      await expect(chips(page).getByRole("tab")).toHaveCount(7);
      await more(page).click();
      await expect(menu(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`single-session menu axe violation ${theme}`, async ({ page }) => {
      await open(page, ONE, theme);
      await more(page).click();
      await expect(menu(page).getByText("Le programme garde au moins une séance.")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`rename axe violation ${theme}`, async ({ page }) => {
      await open(page, [], theme);
      await page.getByRole("button", { name: "Renommer la séance" }).click();
      await expect(nameField(page)).toBeFocused();
      await expect(nameField(page)).toHaveValue("Push");
      await expectNoAxeViolations(page);
    });

    test(`empty session axe violation ${theme}`, async ({ page }) => {
      await open(page, [], theme);
      await add(page).click();
      await expect(page.getByRole("button", { name: "Partir de A · Push" })).toBeVisible();
      await settled(page);
      expect(plain(await title(page).textContent())).toBe("Séance D");
      await expectNoAxeViolations(page);
    });
  });
}
