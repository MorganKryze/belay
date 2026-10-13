import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

// The protein tool's goal is a three-option segmented control on a public screen.
for (const theme of ["light", "dark"] as const) {
  test(`segmented labels read at the secondary size and pass contrast, ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await page.goto("/tools/protein");
    const group = page.getByRole("radiogroup", { name: "Your goal" });
    await expect(group).toBeVisible();
    const sizes = await page
      .locator("#" + (await group.getAttribute("aria-labelledby")))
      .or(group.getByRole("radio"))
      .evaluateAll((all) => all.map((el) => getComputedStyle(el).fontSize));
    expect(sizes).toEqual(["13px", "13px", "13px", "13px"]);
    const { violations } = await new AxeBuilder({ page })
      .include("main")
      .withRules(["color-contrast"])
      .analyze();
    expect(violations.flatMap((v) => v.nodes.map((n) => n.target))).toEqual([]);
  });
}
