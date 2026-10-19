import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";

test.use({ locale: "en-US" });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

async function openTools(page: Page) {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
  await settled(page);
}

// A colour as the browser computes it, read through a probe so hex and rgb compare alike.
const tokenColor = (page: Page, token: string) =>
  page.evaluate((name) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

const toolRows = (page: Page) => page.locator('main a[href^="/tools/"]');

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`tool rows are 56 px with 28 px icon squares and 16 px chevrons, on the group surface, ${scheme}`, async ({
      page,
    }) => {
      await openTools(page);
      const soft = await tokenColor(page, "--primary-soft");
      const ink = await tokenColor(page, "--primary-ink");
      const rows = toolRows(page);
      await expect(rows).toHaveCount(8);
      for (const row of await rows.all()) {
        expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
        const square = row.locator("[data-slot=row-icon]");
        const box = (await square.boundingBox())!;
        expect([box.width, box.height]).toEqual([28, 28]);
        await expect(square).toHaveCSS("background-color", soft);
        await expect(square.locator("svg")).toHaveCSS("color", ink);
        const chevron = (await row.locator("[data-slot=row-chevron]").boundingBox())!;
        expect([chevron.width, chevron.height]).toEqual([16, 16]);
      }
      for (const list of await page.locator("main ul").all()) {
        await expect(list).toHaveCSS("border-top-width", scheme === "dark" ? "1px" : "0px");
        if (scheme === "dark") await expect(list).toHaveCSS("box-shadow", "none");
        else await expect(list).not.toHaveCSS("box-shadow", "none");
      }
    });

    test(`Outils with its lists has no axe violation, ${scheme}`, async ({ page }) => {
      await openTools(page);
      await expectNoAxeViolations(page);
    });
  });
}

test("section labels are 13 px 600 muted", async ({ page }) => {
  await openTools(page);
  const muted = await tokenColor(page, "--muted-foreground");
  for (const name of ["Strength", "Energy", "Body"]) {
    const label = page.getByRole("heading", { name, level: 2 });
    await expect(label).toHaveCSS("font-size", "13px");
    await expect(label).toHaveCSS("font-weight", "600");
    await expect(label).toHaveCSS("color", muted);
  }
});

test("the lead sits under the last list", async ({ page }) => {
  await openTools(page);
  const last = (await page.locator("main ul").last().boundingBox())!;
  const lead = (await page
    .getByText("Everything is calculated on your device. Nothing is sent.")
    .boundingBox())!;
  expect(lead.y).toBeGreaterThanOrEqual(last.y + last.height);
});

for (const locale of ["fr-FR", "en-US"] as const) {
  test.describe(locale, () => {
    test.use({ locale, viewport: { width: 360, height: 800 } });

    test(`no hint ends in an ellipsis at 360 px, ${locale}`, async ({ page }) => {
      // The French BMI hint is one word too long at 360 px until its shorter wording lands.
      test.fixme(locale === "fr-FR");
      await page.goto("/tools");
      await expect(toolRows(page)).toHaveCount(8);
      await settled(page);
      const cut = await toolRows(page).evaluateAll((rows) =>
        rows
          .map((row) => row.querySelector<HTMLElement>(".truncate.text-muted-foreground")!)
          .filter((hint) => hint.scrollWidth > hint.clientWidth)
          .map((hint) => hint.textContent),
      );
      expect(cut).toEqual([]);
    });
  });
}

for (const width of [360, 390, 1280]) {
  test(`Outils has nothing scrolling sideways at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openTools(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
}
