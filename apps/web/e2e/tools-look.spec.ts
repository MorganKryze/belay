import { expect, type Locator, type Page, test } from "@playwright/test";

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
const token = (page: Page, name: string, prop = "background-color") =>
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

const RESULTS = [
  ["/tools/bmi", "Your BMI"],
  ["/tools/energy", "Today's expenditure"],
  ["/tools/one-rep-max", "Your estimated 1RM"],
] as const;

test.describe("a result sits on the kit card, never on primary-soft", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [path, name] of RESULTS) {
      test(`${path}, ${theme}`, async ({ page }) => {
        await open(page, path, theme);
        const card = page.getByRole("region", { name });
        await expect(card).toBeVisible();
        expect(await style(card, "background-color")).toBe(await token(page, "--card"));
        expect(await style(card, "background-color")).not.toBe(await token(page, "--primary-soft"));
        if (theme === "light") {
          expect(await style(card, "border-top-width")).toBe("0px");
          expect(await style(card, "box-shadow")).not.toBe("none");
        } else {
          expect(await style(card, "border-top-width")).toBe("1px");
          expect(await style(card, "box-shadow")).toBe("none");
        }
        const label = card.getByRole("heading", { name });
        expect(await style(label, "font-size")).toBe("13px");
        expect(await style(label, "font-weight")).toBe("600");
        expect(await style(label, "color")).toBe(await token(page, "--muted-foreground", "color"));
      });
    }
  }
});

const row = (page: Page) => page.locator("details > summary").first();

test("How it's calculated is a 56 px row with a 28 px info square and its source label", async ({
  page,
}) => {
  for (const [path, label] of [
    ["/tools/bmi", "Scientific source"],
    ["/tools/energy", "Source and Belay heuristic"],
  ] as const) {
    await open(page, path);
    const summary = row(page);
    await expect(summary).toHaveText(`How it's calculated ${label}`);
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    const square = summary.locator("> span").first();
    const box = (await square.boundingBox())!;
    expect([box.width, box.height]).toEqual([28, 28]);
    expect(await style(square, "background-color")).toBe(await token(page, "--primary-soft"));
    const chevron = summary.locator("svg.lucide-chevron-right");
    const chevronBox = (await chevron.boundingBox())!;
    expect([chevronBox.width, chevronBox.height]).toEqual([16, 16]);
    expect(await style(summary.getByText(label), "font-size")).toBe("13px");
    expect(await style(summary, "list-style-type")).toBe("none");
  }
});

test("the row opens the sheet in place, in the same card", async ({ page }) => {
  await open(page, "/tools/bmi");
  const details = page.locator("details").first();
  const brief = details.getByText("In short");
  await expect(brief).toBeHidden();
  await row(page).click();
  await expect(brief).toBeVisible();
  const card = (await details.boundingBox())!;
  const inner = (await brief.boundingBox())!;
  expect(inner.x).toBeGreaterThanOrEqual(card.x);
  expect(inner.y).toBeGreaterThanOrEqual(card.y);
  expect(inner.x + inner.width).toBeLessThanOrEqual(card.x + card.width);
  expect(inner.y + inner.height).toBeLessThanOrEqual(card.y + card.height);
  expect(await style(details, "background-color")).toBe(await token(page, "--surface"));
  await row(page).click();
  await expect(brief).toBeHidden();
});

test("the BMI hint and the activity levels read the shorter copy", async ({ page }) => {
  await open(page, "/tools");
  await expect(page.getByText("Your place on the WHO ranges")).toBeVisible();
  await page.goto("/tools/energy");
  await expect(page.getByRole("heading", { name: "Energy expenditure", level: 1 })).toBeVisible();
  // The levels and their descriptions live in the activity sheet.
  await page.getByRole("button", { name: /^Your activity/ }).click();
  await expect(
    page.getByText("Sedentary, plus about one hour of moderate to vigorous exercise a day."),
  ).toBeVisible();
  await expect(page.getByText("Hard physical work or exercise for much of the day.")).toBeVisible();
});

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("every tool page has nothing scrolling sideways", async ({ page }) => {
    for (const tool of [
      "one-rep-max",
      "plates",
      "warmup",
      "energy",
      "protein",
      "projection",
      "bmi",
      "body-fat",
    ]) {
      await open(page, `/tools/${tool}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await page.locator("details").evaluateAll((all) => {
        for (const d of all) (d as HTMLDetailsElement).open = true;
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, tool).toBe(0);
    }
  });
});
