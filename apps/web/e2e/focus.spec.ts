import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

test.use({ locale: "en-US" });

const outline = (el: Element) => getComputedStyle(el).outlineStyle;

// A navigation started from the keyboard leaves the browser in keyboard mode, so the h1 the
// layout focuses matches :focus-visible, as it does in WebKit after any navigation.
test("the page title focused after a navigation draws no ring, a keyboard-focused control keeps its own", async ({
  page,
}) => {
  await page.goto("/");
  const tools = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tools" });
  await tools.focus();
  await page.keyboard.press("Enter");
  const h1 = page.getByRole("heading", { level: 1, name: "Tools" });
  await expect(h1).toBeFocused();
  expect(await h1.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  expect(await h1.evaluate(outline)).toBe("none");

  await page.keyboard.press("Tab");
  const focused = page.locator(":focus-visible");
  expect(await focused.evaluate((el) => el.tagName)).not.toBe("H1");
  expect(await focused.evaluate(outline)).toBe("solid");
});
