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

test("the segmented group shows a focus ring while the keyboard moves the choice", async ({
  page,
}) => {
  await page.goto("/tools/protein");
  const group = page.getByRole("radiogroup", { name: "Your goal" });
  await group.getByRole("radio", { checked: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "Cut" })).toBeFocused();
  const ring = await group.evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.outlineStyle} ${s.outlineWidth}`;
  });
  expect(ring).toBe("solid 2px");
});

// As every other ring: after a tap the groove shows none, even where the browser counts the
// focus as a keyboard one (forced here, as Chromium never does it on a tap); Tab brings it back.
test("a tapped segment shows no focus ring, Tab brings it back", async ({ page }) => {
  await page.goto("/tools/protein");
  const group = page.getByRole("radiogroup", { name: "Your goal" });
  const ring = () => group.evaluate((el) => getComputedStyle(el).outlineStyle);
  await group.getByRole("radio", { name: "Cut" }).click();
  await expect(group.getByRole("radio", { name: "Cut" })).toBeChecked();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument");
  const { nodeId } = await cdp.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: "[role=radio][aria-checked=true]",
  });
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["focus-visible"] });
  expect(await ring()).toBe("none");
  await cdp.send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: [] });
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(group.getByRole("radio", { name: "Cut" })).toBeFocused();
  expect(await ring()).toBe("solid");
});
