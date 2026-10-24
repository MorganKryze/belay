import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// Moving, adding and removing rows in the program editor on a computer, the starting program as a
// new account holds it: session A, Push, of six exercises, the last three chained.
test.use({
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
  viewport: { width: 1280, height: 900 },
  colorScheme: "dark",
});

const BENCH = "Barbell bench press";
const PRESS = "Dumbbell seated shoulder press";
const SLED = "Sled 45° leg press";
const RAISE = "Dumbbell lateral raise";
const PUSHDOWN = "Cable pushdown";
const CALF = "Lever standing calf raise";
const FLY = "Cable standing fly";

async function open(page: Page) {
  await fakeServer(page);
  await page.goto("/workouts/program");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(row(page, BENCH)).toBeVisible();
}
const grid = (page: Page) => page.getByRole("grid");
const row = (page: Page, name: string) => grid(page).getByRole("row").filter({ hasText: name });
const handle = (page: Page, name: string) =>
  row(page, name).getByRole("button", { name: `Déplacer ${name}` });
const more = (page: Page, name: string) =>
  row(page, name).getByRole("button", { name: `Actions pour ${name}` });
// Sets, RIR and rest are the second, fourth and fifth cells of a row.
const COLUMN = { sets: 1, rir: 3, rest: 4 } as const;
const cell = (page: Page, name: string, column: keyof typeof COLUMN) =>
  row(page, name).getByRole("gridcell").nth(COLUMN[column]);
const search = (page: Page) => page.getByRole("combobox", { name: "Ajouter un exercice" });
const said = (page: Page) => page.locator('p[aria-live="polite"]');
const size = (page: Page) => page.getByText(/^\d+ exercices · /);
// The exercises' names, top to bottom.
const order = (page: Page) =>
  grid(page)
    .locator("[data-row]")
    .evaluateAll((rows) => rows.map((r) => r.querySelector(".truncate")?.textContent ?? ""));
const middle = async (page: Page, name: string) => {
  const box = (await row(page, name).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, bottom: box.y + box.height };
};

// Tab from the top of the page into the grid, one Tab stop that starts on the first row's sets,
// then ← to that row's handle.
async function tabToHandle(page: Page) {
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => !!document.activeElement?.closest('[role="grid"]'))) {
      await page.keyboard.press("ArrowLeft");
      const name = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      return name?.replace(/^Déplacer /, "");
    }
  }
  throw new Error("the grid is not reached by Tab");
}

// Drags a row's handle with the mouse to a point of the page, in small steps as a hand would.
async function drag(page: Page, name: string, to: { x: number; y: number }) {
  const box = (await handle(page, name).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test("a row moved from the keyboard and an exercise added by search", async ({ page }) => {
  await open(page);
  await expect(size(page)).toHaveText(/^6 exercices · 19 séries/);

  expect(await tabToHandle(page)).toBe(BENCH);
  await page.keyboard.press("ArrowDown");
  await expect(handle(page, PRESS)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(said(page)).toContainText(`${PRESS} soulevé, position 2 sur 6`);
  await page.keyboard.press("ArrowDown");
  await expect(said(page)).toHaveText("position 3 sur 6");
  await page.keyboard.press("Space");
  await expect(said(page)).toHaveText(`${PRESS} posé, position 3 sur 6`);
  await expect.poll(() => order(page)).toEqual([BENCH, SLED, PRESS, RAISE, PUSHDOWN, CALF]);

  await page.getByPlaceholder("Ajouter un exercice").click();
  await expect(search(page)).toBeFocused();
  // « fly » alone lists a dozen flies before this one, alphabetically; « standing fly » puts it first.
  await page.keyboard.type("standing fly");
  await expect(search(page)).toHaveValue("standing fly");
  await expect(page.getByRole("option", { name: new RegExp(FLY) })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await order(page)).at(-1)).toBe(FLY);
  await expect(size(page)).toHaveText(/^7 exercices · 22 séries/);
  await expect(search(page)).toHaveValue("");
  await expect(search(page)).toBeFocused();
});

test("the lifted row takes the soft primary tint with a ring inside", async ({ page }) => {
  await open(page);
  await handle(page, BENCH).focus();
  await page.keyboard.press("Space");
  await expect(row(page, BENCH)).toHaveAttribute("aria-current", "true");
  const style = await row(page, BENCH).evaluate((el) => {
    const probe = document.createElement("div");
    probe.style.background = "var(--primary-soft)";
    probe.style.outlineColor = "var(--primary)";
    document.body.append(probe);
    const want = getComputedStyle(probe);
    const got = getComputedStyle(el);
    const out = {
      tinted: got.backgroundColor === want.backgroundColor,
      ringed: got.outlineColor === want.outlineColor,
      outline: got.outlineStyle,
      width: got.outlineWidth,
      offset: got.outlineOffset,
    };
    probe.remove();
    return out;
  });
  expect(style).toEqual({
    tinted: true,
    ringed: true,
    outline: "solid",
    width: "2px",
    offset: "-2px",
  });
  await page.keyboard.press("Escape");
  await expect(said(page)).toHaveText("Déplacement annulé");
  await expect(row(page, BENCH)).not.toHaveAttribute("aria-current", "true");
});

test("a row dragged with the mouse lands two places down", async ({ page }) => {
  await open(page);
  // Just under the leg press, in the upper half of the gap above the chained rows: outside them.
  const sled = await middle(page, SLED);
  await drag(page, BENCH, { x: sled.x, y: sled.bottom + 2 });
  await expect(said(page)).toHaveText(`${BENCH} posé, position 3 sur 6`);
  await expect.poll(() => order(page)).toEqual([PRESS, SLED, BENCH, RAISE, PUSHDOWN, CALF]);
  // Still outside the group: no group line beside it.
  const line = await row(page, BENCH).evaluate((el) => getComputedStyle(el, "::before").content);
  expect(line).toBe("none");
});

test("a row dropped between two chained rows joins their group", async ({ page }) => {
  await open(page);
  const raise = await middle(page, RAISE);
  await drag(page, BENCH, { x: raise.x, y: raise.bottom + 2 });
  await expect.poll(() => order(page)).toEqual([PRESS, SLED, RAISE, BENCH, PUSHDOWN, CALF]);
  // The group's line, drawn beside each chained row, now runs beside it too.
  const line = await row(page, BENCH).evaluate((el) => {
    const s = getComputedStyle(el, "::before");
    // The line runs the row's height inside its top border.
    return { content: s.content, width: s.width, height: s.height, row: `${el.clientHeight}px` };
  });
  expect(line.content).not.toBe("none");
  expect(line.width).toBe("2px");
  expect(line.height).toBe(line.row);
});

test("/ focuses the search", async ({ page }) => {
  await open(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
  await expect(search(page)).toHaveValue("");
});

test("with « Comme la rangée du dessus » the added row copies the row above", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("belay.editorAdded", "above"));
  await open(page);
  const sets = await cell(page, CALF, "sets").innerText();
  const rir = await cell(page, CALF, "rir").innerText();
  const rest = await cell(page, CALF, "rest").innerText();
  await search(page).click();
  await page.keyboard.type("standing fly");
  await expect(search(page)).toHaveValue("standing fly");
  await page.getByRole("option", { name: new RegExp(FLY) }).click();
  await expect.poll(async () => (await order(page)).at(-1)).toBe(FLY);
  await expect(cell(page, FLY, "sets")).toHaveText(sets);
  await expect(cell(page, FLY, "rir")).toHaveText(rir);
  await expect(cell(page, FLY, "rest")).toHaveText(rest);
});

test("Retirer de la séance offers Annuler, which puts the row back with its values", async ({
  page,
}) => {
  await open(page);
  const sets = await cell(page, PRESS, "sets").innerText();
  await more(page, PRESS).click();
  await page.getByRole("menuitem", { name: "Retirer de la séance" }).click();
  await expect(row(page, PRESS)).toHaveCount(0);
  await page.getByRole("button", { name: "Annuler" }).click();
  await expect.poll(() => order(page)).toEqual([BENCH, PRESS, SLED, RAISE, PUSHDOWN, CALF]);
  await expect(cell(page, PRESS, "sets")).toHaveText(sets);
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`a lifted row has no axe violation, ${scheme}`, async ({ page }) => {
      await open(page);
      await handle(page, PRESS).focus();
      await page.keyboard.press("Space");
      await page.keyboard.press("ArrowDown");
      await expect(said(page)).toHaveText("position 3 sur 6");
      await expectNoAxeViolations(page);
    });

    test(`the search list has no axe violation, ${scheme}`, async ({ page }) => {
      await open(page);
      await search(page).click();
      await page.keyboard.type("fly");
      await expect(search(page)).toHaveValue("fly");
      await page.keyboard.press("ArrowDown");
      await expect(page.getByRole("listbox")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the row menu has no axe violation, ${scheme}`, async ({ page }) => {
      await open(page);
      await more(page, CALF).click();
      await expect(page.getByRole("menu")).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
