import { expect, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";

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

const SCREENS = [
  ["/tools", "Tools"],
  ["/tools/energy", "Energy expenditure"],
  ["/tools/protein", "Protein"],
  ["/tools/projection", "Projection"],
  ["/tools/one-rep-max", "One-rep max"],
  ["/tools/plates", "Plates"],
  ["/tools/warmup", "Warm-up"],
  ["/tools/bmi", "BMI"],
  ["/tools/body-fat", "Body fat"],
  ["/tools/plates/equipment", "My equipment"],
] as const;

test.describe("accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const [path, title] of SCREENS) {
      test(`${path} has no axe violation, ${theme}, sheets open`, async ({ page }) => {
        await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toContainText(title);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        // Every science sheet and its drawers, so the sources and caveats are checked too.
        await page.locator("details").evaluateAll((all) => {
          for (const d of all) (d as HTMLDetailsElement).open = true;
        });
        await expectNoAxeViolations(page);
      });
    }
  }
});
