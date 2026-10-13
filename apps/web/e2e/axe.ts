import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Waits for every animation that ends (a sheet rising, a fade) to finish, so a measure reads the
// page at rest. Looping ones (the loading arc) are left running; a cancelled one counts as done.
export async function settled(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().endTime !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

// WCAG 2.1 A and AA, the whole page as it stands (open sheets and drawers included).
export async function expectNoAxeViolations(page: Page) {
  await settled(page);
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
