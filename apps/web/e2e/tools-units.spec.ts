import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";

test.use({ locale: "fr-FR" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

// The unit is a device preference, set before the app reads it.
async function open(page: Page, path: string, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => {
    localStorage.setItem("belay.weightUnit", "lb");
    localStorage.setItem("belay.theme", t);
  }, theme);
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
}

async function type(page: Page, label: string, value: string, prefilled: string) {
  const field = page.getByRole("textbox", { name: label });
  await expect(field).toHaveValue(prefilled);
  await field.fill(value);
  await field.blur();
}

const main = (page: Page) => page.getByRole("main");
// The screen above "Comment c'est calculé": the science text stays metric, as the spec keeps it.
const tool = async (page: Page) =>
  (await main(page).innerText()).split("Comment c’est calculé")[0]!;

test("1RM takes 225 lb and answers whole pounds", async ({ page }) => {
  await open(page, "/tools/one-rep-max");
  await type(page, "Répétitions", "6", "5");
  // 100 kg stored, read as 220 lb.
  await type(page, "Charge", "225", "220");
  const figures = page
    .getByRole("region", { name: "Ton 1RM estimé" })
    .locator("[data-slot=result-figure]");
  await expect(figures).toHaveText(["270 lb", "261 lb"]);
  expect(await tool(page)).not.toContain("kg");
});

test("Disques loads 225 lb as 45 + 45 per side on a 45 lb bar, plates grey", async ({ page }) => {
  await open(page, "/tools/plates");
  await type(page, "Charge visée", "225", "220");
  const card = page.getByRole("region", { name: "De chaque côté" });
  const drawing = card.getByRole("img", { name: "45 + 45 lb par côté" });
  await expect(drawing).toBeVisible();
  await expect(card.getByText("Barre de 45 lb")).toBeVisible();
  // No colour standard for pound plates: each plate fills with the neutral grey of the sleeves.
  const grey = await drawing
    .locator(":scope > rect")
    .first()
    .evaluate((n) => getComputedStyle(n).fill);
  const plates = drawing.locator("g > rect");
  await expect(plates).toHaveCount(4);
  for (const plate of await plates.all())
    expect(await plate.evaluate((n) => getComputedStyle(n).fill)).toBe(grey);
  expect(await tool(page)).not.toContain("kg");
});

test("Échauffement for 225 lb lists pound loads from the pound set", async ({ page }) => {
  await open(page, "/tools/warmup");
  await type(page, "Charge de travail", "225", "220");
  const list = page.getByRole("region", { name: "Ton échauffement" });
  await expect(list.getByRole("listitem")).toHaveText([
    /^1110 lb 25 \+ 5 \+ 2,5 par côté/,
    /^2170 lb 35 \+ 25 \+ 2,5 par côté/,
    /^225 lb séries de travail/,
  ]);
  expect(await tool(page)).not.toContain("kg");
});

test("Matériel shows the pound set read-only with its note", async ({ page }) => {
  await open(page, "/tools/plates/equipment");
  await expect(
    page.getByText("En livres, Belay prend la barre de 45 lb et les disques standard."),
  ).toBeVisible();
  await expect(main(page).getByText("45 lb", { exact: true })).toBeVisible();
  await expect(main(page).getByRole("button")).toHaveCount(0);
  await expect(main(page)).not.toContainText("kg");
});

for (const scheme of ["light", "dark"] as const) {
  test(`Disques in pounds has no axe violation, ${scheme}`, async ({ page }) => {
    await open(page, "/tools/plates", scheme);
    await expect(page.getByRole("img", { name: /lb par côté$/ })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test(`Matériel in pounds has no axe violation, ${scheme}`, async ({ page }) => {
    await open(page, "/tools/plates/equipment", scheme);
    await expect(page.getByText(/^En livres, Belay/)).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test("the pound tools fit at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  for (const path of [
    "/tools/one-rep-max",
    "/tools/plates",
    "/tools/warmup",
    "/tools/plates/equipment",
  ]) {
    await open(page, path);
    await expect(main(page)).toContainText("lb");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
  }
});
