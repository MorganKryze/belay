import { expect, type Locator, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

test.use({ locale: "en-US" });

const select = (el: Locator) => el.evaluate((node) => getComputedStyle(node).userSelect);

test("on a touch screen a row, a tab, a title and a figure cannot be selected, a field and the science text can", async ({
  page,
}) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  expect(await select(page.getByRole("heading", { level: 1 }))).toBe("none");
  expect(
    await select(page.getByRole("navigation", { name: "Main" }).getByRole("link").first()),
  ).toBe("none");
  expect(await select(page.getByRole("button", { name: /^Intake/ }))).toBe("none");

  await page.goto("/tools/bmi");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await select(page.getByRole("region", { name: "Your BMI" }))).toBe("none");
  expect(await select(page.locator("input:not([type=hidden])").first())).toBe("text");
  const sheet = page.locator("details > summary").first();
  await sheet.click();
  expect(await select(page.getByText("In short"))).toBe("text");
  expect(await select(page.locator("details p").first())).toBe("text");
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 }, hasTouch: false, isMobile: false });

  test("a title stays selectable", async ({ page }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    expect(await select(page.getByRole("heading", { level: 1 }))).toBe("auto");
  });
});
