import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

// Default inputs on a fresh device, and a piece of the result each one must show.
const TOOLS = [
  ["One-rep max", "Your estimated 1RM", "116.5"],
  ["Plates", "On each side", "20 + 20 kg per side"],
  ["Warm-up", "Your warm-up", "working sets"],
  ["Energy expenditure", "Today's expenditure", "kcal"],
  ["Protein", "Per day", "100 to 140"],
  ["Projection", "Goal reached", "weeks"],
  ["BMI", "Your BMI", "24.2"],
  ["Body fat", "Your estimated body fat", "%"],
] as const;

test.describe("in English", () => {
  test.use({ locale: "en-US" });

  for (const [name, result, expected] of TOOLS) {
    test(`${name}: from the list to a result`, async ({ page }) => {
      await page.goto("/");
      await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Tools" })
        .click();
      await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
      await expect(page.getByRole("region", { name: result })).toContainText(expected);
    });
  }
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("speaks French with the decimal comma", async ({ page }) => {
    await page.goto("/tools/bmi");
    await expect(page.getByRole("heading", { name: "IMC", level: 1 })).toBeVisible();
    await expect(page.getByRole("region", { name: "Ton IMC" })).toContainText("24,2");
    const height = page.getByRole("textbox", { name: "Taille" });
    await height.fill("178");
    await height.blur();
    const weight = page.getByRole("textbox", { name: "Poids" });
    await weight.fill("77,5");
    await weight.blur();
    await expect(page.getByRole("region", { name: "Ton IMC" })).toContainText("24,5");
  });
});

test("remembers inputs on the device, across tools", async ({ page }) => {
  await page.goto("/tools/bmi");
  const weight = page.getByRole("textbox", { name: "Weight" });
  await weight.fill("82");
  await weight.blur();
  await page.goto("/tools/protein");
  await expect(page.getByRole("textbox", { name: "Weight" })).toHaveValue("82");
});

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test.describe("accessibility", () => {
  test("the tools list has no axe violation", async ({ page }) => {
    await page.goto("/tools");
    await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("BMI, sheet open, has no axe violation", async ({ page }) => {
    await page.goto("/tools/bmi");
    await page.getByText("How it's calculated").click();
    await page.getByText("The sources").click();
    await expectNoAxeViolations(page);
  });

  test("projection has no axe violation", async ({ page }) => {
    await page.goto("/tools/projection");
    await expect(page.getByRole("region", { name: "Goal reached" })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test("the dark theme applies to the tools and passes axe", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("belay.theme", "dark"));
    await page.goto("/tools/body-fat");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByRole("region", { name: "Your estimated body fat" })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
