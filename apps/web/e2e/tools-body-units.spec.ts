import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";

test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

// The same stored kg on both runs: only the unit, a device preference, changes.
const STATE = { formula: "male", heightCm: 178, weightKg: 80 };

async function open(
  page: Page,
  tool: string,
  unit: "kg" | "lb",
  theme: "light" | "dark" = "light",
) {
  await page.addInitScript(
    ([u, t, s]) => {
      localStorage.setItem("belay.weightUnit", u);
      localStorage.setItem("belay.theme", t);
      localStorage.setItem("belay.tools.v1", s);
    },
    [unit, theme, JSON.stringify(STATE)] as const,
  );
  await page.goto(`/tools/${tool}`);
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
  const weight = page.getByRole("textbox", { name: /^(Weight|Average weight)/ });
  // The stored 80 kg shows 176 lb: wait for it before typing over it.
  await expect(weight).toHaveValue(unit === "kg" ? "80" : "176");
  return weight;
}

const CARDS = {
  bmi: "Your BMI",
  energy: "Today's expenditure",
  protein: "Per day",
  projection: "Goal reached",
} as const;

for (const [tool, card] of Object.entries(CARDS)) {
  test(`${tool} takes lb and gives the kilo result`, async ({ browser }) => {
    const kg = await browser.newPage();
    await kg.route("**/api/me", (r) => r.fulfill({ status: 401 }));
    await open(kg, tool, "kg");
    const kilo = await kg.getByRole("region", { name: card }).textContent();
    await kg.close();
    const page = await browser.newPage();
    await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
    await open(page, tool, "lb");
    await expect(page.getByText("lb", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("region", { name: card })).toHaveText(kilo!);
    await page.close();
  });
}

test("IMC typed in lb: 176 lb at 178 cm is 25.2", async ({ page }) => {
  const field = await open(page, "bmi", "lb");
  await field.fill("176");
  await field.blur();
  await expect(page.getByRole("region", { name: "Your BMI" })).toContainText("25.2");
});

test("Projection's weekly rate and goal are in lb", async ({ page }) => {
  await open(page, "projection", "lb");
  await expect(page.getByText("0.75% · 1.3 lb per week")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /^Goal/ })).toHaveValue("165");
});

for (const theme of ["light", "dark"] as const)
  for (const tool of ["projection", "protein"])
    test(`${tool} in lb has no axe violation (${theme})`, async ({ page }) => {
      await open(page, tool, "lb", theme);
      await expectNoAxeViolations(page);
    });
