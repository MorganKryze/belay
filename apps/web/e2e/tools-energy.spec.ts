import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";

test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

async function open(page: Page, path: string, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
  // The fields are prefilled: the result reads them once they are in.
  await expect(page.getByRole("textbox", { name: /^(Weight|Poids)/ })).not.toHaveValue("");
}

// A custom property resolved to the color the browser computes, for a fair comparison.
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("div");
    probe.style.setProperty("color", `var(${n})`);
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);

const style = (el: Locator, prop: string) =>
  el.evaluate((node, p) => getComputedStyle(node).getPropertyValue(p), prop);

const box = async (el: Locator) => (await el.boundingBox())!;

const activityRow = (page: Page, name = "Your activity") =>
  page.getByRole("button", { name: new RegExp(`^${name}`) });

async function openSheet(page: Page, name = "Your activity") {
  await activityRow(page, name).click();
  const list = page.getByRole("listbox", { name });
  await expect(list).toBeVisible();
  await settled(page);
  return list;
}

test("Your activity is a 56 px row with the level on its second line and a 16 px chevron", async ({
  page,
}) => {
  await open(page, "/tools/energy");
  const row = activityRow(page);
  await expect(row).toHaveText("Your activity Sedentary / light activity · 1.55");
  expect((await box(row)).height).toBeGreaterThanOrEqual(56);
  const label = row.getByText("Your activity", { exact: true });
  const level = row.getByText("Sedentary / light activity · 1.55", { exact: true });
  expect((await box(level)).y).toBeGreaterThanOrEqual(
    (await box(label)).y + (await box(label)).height - 1,
  );
  const chevron = row.locator('[data-slot="row-chevron"]');
  const c = await box(chevron);
  expect([c.width, c.height]).toEqual([16, 16]);
});

test("the sheet lists four options of at least 56 px, the check on the chosen one in primary-ink", async ({
  page,
}) => {
  await open(page, "/tools/energy");
  const list = await openSheet(page);
  const options = list.getByRole("option");
  await expect(options).toHaveCount(4);
  for (const option of await options.all()) {
    expect((await box(option)).height).toBeGreaterThanOrEqual(56);
  }
  const chosen = list.getByRole("option", { selected: true });
  await expect(chosen).toHaveText(/^Sedentary \/ light activity/);
  await expect(list.locator("svg")).toHaveCount(1);
  const check = chosen.locator("svg");
  const c = await box(check);
  expect([c.width, c.height]).toEqual([20, 20]);
  expect(await style(check, "color")).toBe(await token(page, "--primary-ink"));
});

test.describe("French at 360 px", () => {
  test.use({ locale: "fr-FR", viewport: { width: 360, height: 800 } });

  test("each option holds in three lines at 360 px in French", async ({ page }) => {
    await open(page, "/tools/energy");
    const list = await openSheet(page, "Ton activité");
    const options = list.getByRole("option");
    await expect(options).toHaveCount(4);
    await expect(list.getByRole("option", { name: /^Actif/ })).toBeVisible();
    for (const option of await options.all()) {
      // The description: the second line of the option's text column.
      const description = option.locator("> span:first-child > span:last-child");
      const lineHeight = parseFloat(await style(description, "line-height"));
      expect(lineHeight).toBeGreaterThan(0);
      expect((await box(description)).height).toBeLessThanOrEqual(3 * lineHeight + 0.5);
    }
  });
});

test("tapping Active closes the sheet and the row already says Active · 1.75", async ({ page }) => {
  await open(page, "/tools/energy");
  const list = await openSheet(page);
  // Records the row's text at the moment the dialog leaves the page (the real exit, 300 ms).
  await page.evaluate(() => {
    const w = window as unknown as { rowWhenGone?: string };
    const observer = new MutationObserver(() => {
      if (!document.querySelector('[role="dialog"]')) {
        w.rowWhenGone = [...document.querySelectorAll("button")]
          .find((b) => b.textContent?.startsWith("Your activity"))
          ?.textContent?.trim();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
  await list.getByRole("option", { name: /^Active/ }).click();
  const right = await page.evaluate(() => ({
    dialog: document.querySelector('[role="dialog"]') !== null,
    row: [...document.querySelectorAll("button")]
      .find((b) => b.textContent?.startsWith("Your activity"))
      ?.textContent?.trim(),
  }));
  expect(right.dialog).toBe(true);
  expect(right.row).toBe("Your activity Active · 1.75");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { rowWhenGone?: string }).rowWhenGone)).toBe(
    "Your activity Active · 1.75",
  );
  await expect(activityRow(page)).toHaveText("Your activity Active · 1.75");
});

test("the energy result is 50 px 700 tabular, kcal 17 px muted, the BMR under a hairline in --border", async ({
  page,
}) => {
  await open(page, "/tools/energy");
  const card = page.getByRole("region", { name: "Today's expenditure" });
  const figure = card.locator('[data-slot="result-figure"]');
  await expect(figure).toHaveText(/^\d[\d,]*\u00a0kcal$/);
  expect(await style(figure, "font-size")).toBe("50px");
  expect(await style(figure, "font-weight")).toBe("700");
  expect(await style(figure, "font-variant-numeric")).toBe("tabular-nums");
  const unit = figure.locator("span");
  expect(await style(unit, "font-size")).toBe("17px");
  expect(await style(unit, "color")).toBe(await token(page, "--muted-foreground"));
  const bmr = card.getByText("Resting energy expenditure").locator("..");
  expect(await style(bmr, "border-top-width")).toBe("1px");
  expect(await style(bmr, "border-top-color")).toBe(await token(page, "--border"));
  const value = bmr.locator("b");
  expect(await style(value, "font-size")).toBe("15px");
  expect(await style(value, "font-weight")).toBe("600");
  expect(await style(value, "font-variant-numeric")).toBe("tabular-nums");
});

test("protein's range is 50 px and its meals' labels are muted, not primary-ink", async ({
  page,
}) => {
  await open(page, "/tools/protein");
  const card = page.getByRole("region", { name: "Per day" });
  const figure = card.locator('[data-slot="result-figure"]');
  await expect(figure).toHaveText(/\u00a0g$/);
  expect(await style(figure, "font-size")).toBe("50px");
  const muted = await token(page, "--muted-foreground");
  const ink = await token(page, "--primary-ink");
  for (const name of ["Over 3 meals", "Over 4 meals"]) {
    const label = card.getByText(name, { exact: true });
    expect(await style(label, "font-size")).toBe("13px");
    expect(await style(label, "color")).toBe(muted);
    expect(await style(label, "color")).not.toBe(ink);
    const value = label.locator("+ div");
    expect(await style(value, "font-size")).toBe("17px");
    expect(await style(value, "font-weight")).toBe("700");
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`Energy with the activity sheet open has no axe violation, ${theme}`, async ({ page }) => {
    await open(page, "/tools/energy", theme);
    await openSheet(page);
    await expectNoAxeViolations(page);
  });
}

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("Energy and Protein have nothing scrolling sideways at 360 px", async ({ page }) => {
    const wide = () =>
      page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await open(page, "/tools/energy");
    expect(await wide()).toBe(false);
    await openSheet(page);
    expect(await wide()).toBe(false);
    await open(page, "/tools/protein");
    expect(await wide()).toBe(false);
  });
});
