import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";

test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

async function open(page: Page, theme: "light" | "dark" = "light") {
  await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await page.goto("/tools/projection");
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("textbox", { name: /^Average weight/ })).not.toHaveValue("");
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

test("the pace is a segment of three, its line 13 px muted below it", async ({ page }) => {
  await open(page);
  const group = page.getByRole("radiogroup", { name: "Your pace (loss per week)" });
  await expect(group.getByRole("radio")).toHaveText(["Gentle", "Balanced", "Steady"]);
  await expect(group.getByRole("radio", { name: "Balanced" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  const line = page.getByText(/% · .* kg per week$/);
  expect(await style(line, "font-size")).toBe("13px");
  expect(await style(line, "color")).toBe(await token(page, "--muted-foreground"));
  const before = await line.textContent();
  await group.getByRole("radio", { name: "Steady" }).click();
  await expect(group.getByRole("radio", { name: "Steady" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(line).not.toHaveText(before!);
});

test("Fine-tune is in primary, the range 22 px 700, the weeks 13.5 px muted", async ({ page }) => {
  await open(page);
  const fine = page.getByRole("button", { name: "Fine-tune ›" });
  expect(await style(fine, "color")).toBe(await token(page, "--primary"));
  const range = page.getByText(/^Between /);
  expect(await style(range, "font-size")).toBe("22px");
  expect(await style(range, "font-weight")).toBe("700");
  const weeks = page.getByText(/^In \d+ to \d+ weeks/);
  expect(await style(weeks, "font-size")).toBe("13.5px");
  expect(await style(weeks, "color")).toBe(await token(page, "--muted-foreground"));
});

for (const theme of ["light", "dark"] as const) {
  test(`Projection has no axe violation, ${theme}`, async ({ page }) => {
    await open(page, theme);
    await expectNoAxeViolations(page);
  });
}

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 800 } });

  test("Projection has nothing scrolling sideways at 360 px", async ({ page }) => {
    await open(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    ).toBe(false);
  });
});
