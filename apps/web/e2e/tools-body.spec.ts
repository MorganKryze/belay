import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

// A body fat of 17 %, inside the reference band (DoD vector), and a BMI of 24.2.
const STATE = {
  formula: "male",
  heightCm: 177.8,
  weightKg: 76.5,
  lastInputs: { "body-fat": { ageYears: 30, neckCm: 39.5, waistCm: 86.5 } },
};

async function open(page: Page, path: string, theme: "light" | "dark" = "light") {
  await page.addInitScript(
    ([t, s]) => {
      localStorage.setItem("belay.theme", t!);
      localStorage.setItem("belay.tools.v1", s!);
    },
    [theme, JSON.stringify(STATE)],
  );
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
}

// A custom property resolved to the color the browser computes, for a fair comparison.
const token = (page: Page, name: string, prop = "background-color") =>
  page.evaluate(
    ([n, p]) => {
      const probe = document.createElement("div");
      probe.style.setProperty(p!, `var(${n})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p!);
      probe.remove();
      return value;
    },
    [name, prop],
  );

const style = (el: Locator, prop: string) =>
  el.evaluate((node, p) => getComputedStyle(node).getPropertyValue(p), prop);

async function expectLargeFigure(figure: Locator) {
  expect(await style(figure, "font-size")).toBe("50px");
  expect(await style(figure, "font-weight")).toBe("700");
  expect(await style(figure, "font-variant-numeric")).toBe("tabular-nums");
}

test.describe("en", () => {
  test.use({ locale: "en-US" });

  test("the BMI and the body fat are 50 px 700 tabular", async ({ page }) => {
    await open(page, "/tools/bmi");
    const bmi = page.getByRole("region", { name: "Your BMI" }).locator("[data-slot=result-figure]");
    await expect(bmi).toHaveText("24.2");
    await expectLargeFigure(bmi);

    await open(page, "/tools/body-fat");
    const card = page.getByRole("region", { name: "Your estimated body fat" });
    const fat = card.locator("[data-slot=result-figure]");
    await expect(fat).toHaveText("17%");
    await expectLargeFigure(fat);
    for (const line of [card.getByText("estimate ±4 points"), card.getByText(/overestimate/)]) {
      expect(await style(line, "font-size")).toBe("13.5px");
      expect(await style(line, "color")).toBe(await token(page, "--muted-foreground", "color"));
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the references sit on the group surface with no orange bar, ${theme}`, async ({
      page,
    }) => {
      await open(page, "/tools/body-fat", theme);
      const list = page.getByRole("list", { name: "Reference values" });
      expect(await style(list, "background-color")).toBe(await token(page, "--surface"));
      if (theme === "light") {
        expect(await style(list, "box-shadow")).not.toBe("none");
        expect(await style(list, "border-top-width")).toBe("0px");
      } else {
        expect(await style(list, "border-top-width")).toBe("1px");
      }
      const current = list.locator("[aria-current]");
      expect(await style(current, "box-shadow")).not.toContain("inset");
      expect((await current.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    });

    test(`the you pill is primary with primary-foreground text, also in the reference row, ${theme}`, async ({
      page,
    }) => {
      await open(page, "/tools/body-fat", theme);
      const current = page
        .getByRole("list", { name: "Reference values" })
        .locator("[aria-current]");
      expect(await style(current, "background-color")).toBe(await token(page, "--reference"));
      const pill = current.getByText("you", { exact: true });
      expect(await style(pill, "background-color")).toBe(await token(page, "--primary"));
      expect(await style(pill, "color")).toBe(await token(page, "--primary-foreground", "color"));
    });
  }

  test("nothing scrolls sideways at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const path of ["/tools/bmi", "/tools/body-fat"]) {
      await open(page, path);
      await expect(page.getByRole("list")).not.toHaveCount(0);
      const [scroll, client] = await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.clientWidth,
      ]);
      expect(scroll).toBeLessThanOrEqual(client);
    }
  });

  for (const theme of ["light", "dark"] as const) {
    test(`IMC and Masse grasse have no axe violation, ${theme}`, async ({ page }) => {
      for (const path of ["/tools/bmi", "/tools/body-fat"]) {
        await open(page, path, theme);
        await expect(page.getByRole("list").first()).toBeVisible();
        await expectNoAxeViolations(page);
      }
    });
  }
});

test.describe("fr", () => {
  test.use({ locale: "fr-FR" });

  test("the percent is 17 px muted after a narrow no-break space", async ({ page }) => {
    await open(page, "/tools/body-fat");
    const fat = page
      .getByRole("region", { name: "Ta masse grasse estimée" })
      .locator("[data-slot=result-figure]");
    await expect(fat).toHaveText("17 %");
    await expectLargeFigure(fat);
    const unit = fat.locator("span");
    await expect(unit).toHaveText(" %");
    expect(await style(unit, "font-size")).toBe("17px");
    expect(await style(unit, "color")).toBe(await token(page, "--muted-foreground", "color"));
  });

  test("Repères is a 13 px 600 muted label over the list", async ({ page }) => {
    await open(page, "/tools/body-fat");
    const label = page.getByRole("heading", { name: "Repères" });
    const list = page.getByRole("list", { name: "Repères" });
    await expect(list).toBeVisible();
    expect(await style(label, "font-size")).toBe("13px");
    expect(await style(label, "font-weight")).toBe("600");
    expect(await style(label, "color")).toBe(await token(page, "--muted-foreground", "color"));
    expect((await label.boundingBox())!.y).toBeLessThan((await list.boundingBox())!.y);
  });
});
