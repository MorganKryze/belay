import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";

test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

async function open(page: Page, path: string, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
}

// A custom property resolved to the color the browser computes, for a fair comparison.
const token = (page: Page, name: string, prop = "color") =>
  page.evaluate(
    ([n, p]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(p!, `var(${n})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p!);
      probe.remove();
      return value;
    },
    [name, prop],
  );

const style = (el: Locator, prop: string) =>
  el.evaluate((node, p) => getComputedStyle(node).getPropertyValue(p), prop);

async function type(page: Page, label: string, value: string, prefilled: string) {
  const field = page.getByRole("textbox", { name: label });
  await expect(field).toHaveValue(prefilled);
  await field.fill(value);
  await field.blur();
}

const figures = (page: Page) =>
  page.getByRole("region", { name: "Your estimated 1RM" }).locator("[data-slot=result-figure]");

test("the 1RM pair is 34 px, 700, tabular, its unit 14 px muted", async ({ page }) => {
  await open(page, "/tools/one-rep-max");
  await type(page, "Reps", "7", "5");
  await type(page, "Load", "80", "100");
  await expect(figures(page)).toHaveText(["98.5 kg", "96 kg"]);
  const muted = await token(page, "--muted-foreground");
  for (const figure of await figures(page).all()) {
    expect(await style(figure, "font-size")).toBe("34px");
    expect(await style(figure, "font-weight")).toBe("700");
    expect(await style(figure, "font-variant-numeric")).toBe("tabular-nums");
    expect(await style(figure, "color")).toBe(await token(page, "--foreground"));
    const unit = figure.locator("span");
    expect(await style(unit, "font-size")).toBe("14px");
    expect(await style(unit, "color")).toBe(muted);
  }
});

test("beyond 10 reps both figures turn muted", async ({ page }) => {
  await open(page, "/tools/one-rep-max");
  await type(page, "Reps", "12", "5");
  await expect(page.getByText("Beyond 10 reps, the estimate is less reliable.")).toBeVisible();
  const muted = await token(page, "--muted-foreground");
  for (const figure of await figures(page).all()) {
    expect(await style(figure, "color")).toBe(muted);
  }
  const note = page.getByText("Beyond 10 reps, the estimate is less reliable.");
  expect(await style(note, "font-size")).toBe("13.5px");
  expect(await style(note, "color")).toBe(muted);
});

test("plates per side are 15 px 600 and the bar 13.5 px muted", async ({ page }) => {
  await open(page, "/tools/plates");
  const card = page.getByRole("region", { name: "On each side" });
  const plates = card.locator("p", { hasText: "20 + 20 kg per side" });
  expect(await style(plates, "font-size")).toBe("15px");
  expect(await style(plates, "font-weight")).toBe("600");
  expect(await style(plates, "font-variant-numeric")).toBe("tabular-nums");
  const bar = card.getByText("20 kg bar");
  expect(await style(bar, "font-size")).toBe("13.5px");
  expect(await style(bar, "color")).toBe(await token(page, "--muted-foreground"));
});

test("an unreachable load lists each neighbour under a hairline", async ({ page }) => {
  await open(page, "/tools/plates");
  await type(page, "Target load", "125.5", "100");
  const card = page.getByRole("region", { name: "On each side" });
  for (const name of ["Just below · 125 kg", "Just above · 130 kg"]) {
    const head = card.getByText(name, { exact: true });
    await expect(head).toBeVisible();
    expect(await style(head, "font-size")).toBe("15px");
    expect(await style(head, "font-weight")).toBe("600");
    const block = head.locator("..");
    expect(await style(block, "border-top-width")).toBe("1px");
    expect(await style(block, "border-top-color")).toBe(
      await token(page, "--border", "border-top-color"),
    );
    const detail = head.locator("+ p");
    expect(await style(detail, "font-size")).toBe("13.5px");
    expect(await style(detail, "color")).toBe(await token(page, "--muted-foreground"));
  }
});

test("My equipment is a 56 px row with Gym at its right and a 16 px chevron", async ({ page }) => {
  await open(page, "/tools/plates");
  const row = page.getByRole("link", { name: "My equipment Gym" });
  const box = (await row.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);
  const gym = row.getByText("Gym", { exact: true });
  const label = row.getByText("My equipment", { exact: true });
  expect((await gym.boundingBox())!.x).toBeGreaterThan((await label.boundingBox())!.x + 50);
  const chevron = row.locator("[data-slot=row-chevron]");
  const c = (await chevron.boundingBox())!;
  expect([c.width, c.height]).toEqual([16, 16]);
  await row.click();
  await expect(page.getByRole("heading", { name: "My equipment", level: 1 })).toBeVisible();
});

test("warm-up sets are 56 px rows with 28 px tiles, the reps in the text ink, the working sets' check square on primary-soft", async ({
  page,
}) => {
  await open(page, "/tools/warmup");
  const list = page.getByRole("region", { name: "Your warm-up" });
  const rows = list.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  const ink = await token(page, "--foreground");
  for (const row of await rows.all()) {
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(56);
    const tile = row.locator("[aria-hidden]").first();
    const t = (await tile.boundingBox())!;
    expect([t.width, t.height]).toEqual([28, 28]);
  }
  const reps = rows.first().getByText("× 5", { exact: true });
  expect(await style(reps, "color")).toBe(ink);
  expect(await style(reps, "font-size")).toBe("15px");
  expect(await style(reps, "font-weight")).toBe("600");
  const check = rows.last().locator("[aria-hidden]").first();
  expect(await style(check, "background-color")).toBe(
    await token(page, "--primary-soft", "background-color"),
  );
  const icon = check.locator("svg");
  const i = (await icon.boundingBox())!;
  expect([i.width, i.height]).toEqual([20, 20]);
  expect(await style(icon, "color")).toBe(await token(page, "--primary-ink"));
});

test("no row of the warm-up is orange", async ({ page }) => {
  await open(page, "/tools/warmup");
  const rows = page.getByRole("region", { name: "Your warm-up" }).getByRole("listitem");
  await expect(rows).toHaveCount(3);
  const soft = await token(page, "--primary-soft", "background-color");
  for (const row of await rows.all()) {
    expect(await style(row, "background-color")).not.toBe(soft);
    expect(await style(row.locator("> div"), "background-color")).not.toBe(soft);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`1RM at 12 reps, Plates not loadable and the warm-up have no axe violation, ${theme}`, async ({
    page,
  }) => {
    await open(page, "/tools/one-rep-max", theme);
    await type(page, "Reps", "12", "5");
    await expectNoAxeViolations(page);
    await page.goto("/tools/plates");
    await expect(page.locator(".launch")).toBeHidden();
    await type(page, "Target load", "125.5", "100");
    await expect(page.getByText("Just below · 125 kg")).toBeVisible();
    await expectNoAxeViolations(page);
    await page.goto("/tools/warmup");
    await expect(page.getByRole("region", { name: "Your warm-up" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
}

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("the three tools have nothing scrolling sideways at 360 px", async ({ page }) => {
    for (const [path, field, value, prefilled] of [
      ["/tools/one-rep-max", "Reps", "12", "5"],
      ["/tools/plates", "Target load", "125.5", "100"],
      ["/tools/warmup", "Working load", "182.5", "100"],
    ] as const) {
      await open(page, path);
      await type(page, field, value, prefilled);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, path).toBe(0);
    }
  });
});
