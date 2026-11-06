import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer } from "./fake-server";
import { asAndroid } from "./native";

// Text follows the phone's text size, or a browser's default font size, and nothing else grows:
// margins and gaps keep their px, titles grow less than body text and the tab labels stop at x1.3.
test.use({ locale: "en-US" });

// The charter's type steps and their size in px at the default text size.
const STEPS: Record<string, number> = {
  figure: 50,
  "figure-md": 34,
  "title-lg": 30,
  "title-session": 22,
  "title-card": 19,
  "title-compact": 17,
  button: 16,
  body: 15,
  secondary: 13,
  section: 13,
  tab: 11.5,
};

// Each step's computed size on this page, in px.
const stepSizes = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(
    (names) =>
      Object.fromEntries(
        names.map((name) => {
          const probe = document.createElement("span");
          probe.style.fontSize = `var(--text-${name})`;
          document.body.append(probe);
          const size = parseFloat(getComputedStyle(probe).fontSize);
          probe.remove();
          return [name, size];
        }),
      ),
    Object.keys(STEPS),
  );

const px = (value: string) => parseFloat(value);

// The one-rep max tool: a large title, a stepper, a result card and the dock.
async function openTool(page: Page) {
  await fakeServer(page);
  await page.goto("/tools/one-rep-max");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.locator("main h1").first()).toBeVisible();
  await settled(page);
}

const resultCard = (page: Page) => page.locator("main h2").first().locator("..");
const homeTab = (page: Page) => page.getByRole("link", { name: "Home", exact: true });
const style = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { fontSize: s.fontSize, minHeight: s.minHeight, padding: s.padding };
    });

for (const width of [360, 390, 1280]) {
  test(`at the default text size every type step keeps its size at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openTool(page);
    expect(await stepSizes(page)).toEqual(STEPS);
  });
}

test("Android at x2.35 grows text, damps the title, caps the tabs and keeps the spacing", async ({
  page,
}) => {
  await asAndroid(page, { textScale: 2.35 });
  await page.setViewportSize({ width: 390, height: 844 });
  await openTool(page);

  const sizes = await stepSizes(page);
  expect(sizes.body).toBeCloseTo(35.25, 2);
  expect(sizes.tab).toBeLessThanOrEqual(11.5 * 1.3 + 0.01);
  expect(
    px(
      await page
        .locator("main h1")
        .first()
        .evaluate((h) => getComputedStyle(h).fontSize),
    ),
  ).toBeGreaterThanOrEqual(30 * 1.5);

  // The card's 16 px sides and 14 px top hold, 4 px steps as at the default size.
  const card = await resultCard(page).evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.paddingLeft, s.paddingTop];
  });
  expect(card).toEqual(["16px", "14px"]);

  // The tab label stops at x1.3 and keeps its name.
  await expect(homeTab(page)).toBeVisible();
  expect(px(await homeTab(page).evaluate((a) => getComputedStyle(a).fontSize))).toBeLessThanOrEqual(
    11.5 * 1.3 + 0.01,
  );

  // A stepper makes room for its larger figure.
  expect(px((await style(page, "main .field")).minHeight)).toBeGreaterThan(50);
});

test("Android at x0.82 shrinks text, a field staying at 16 px", async ({ page }) => {
  await asAndroid(page, { textScale: 0.82 });
  await fakeServer(page);
  await page.goto("/workouts?tab=exercises");
  await expect(page.locator(".launch")).toBeHidden();
  const field = page.locator("main input.text-base").first();
  await expect(field).toBeVisible();

  expect((await stepSizes(page)).body).toBeCloseTo(15 * 0.82, 2);
  expect(await field.evaluate((f) => getComputedStyle(f).fontSize)).toBe("16px");
  // The stepper's floor stays the 50 px target.
  await page.goto("/tools/one-rep-max");
  await expect(page.locator("main h1").first()).toBeVisible();
  expect((await style(page, "main .field")).minHeight).toBe("50px");
});

// A browser whose default font size is 24 px: the root at 150 % stands in for it.
for (const width of [1280, 390]) {
  test(`a larger browser font size grows text and no spacing at ${width} px`, async ({ page }) => {
    // The script runs before the parser makes the root, so it sets the size once there is one.
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        document.documentElement.style.fontSize = "150%";
      });
    });
    await page.setViewportSize({ width, height: 800 });
    await openTool(page);

    const sizes = await stepSizes(page);
    expect(sizes.body).toBeCloseTo(22.5, 2);
    expect(sizes["title-lg"]).toBeCloseTo(45, 2);
    const card = await resultCard(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.paddingLeft, s.paddingTop];
    });
    expect(card).toEqual(["16px", "14px"]);
  });
}
