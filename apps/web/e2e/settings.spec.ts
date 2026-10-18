import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer, refuseChanges } from "./fake-server";

// Signed in as Ada, in English.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const row = (page: Page, name: "Language" | "Theme") =>
  page.getByRole("combobox", { name: new RegExp(`^${name}`) });

const signOut = (page: Page) => page.getByRole("button", { name: "Sign out" });

async function openSettings(page: Page, theme?: "light" | "dark") {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page);
  await page.goto("/settings");
  await expect(row(page, "Language")).toBeVisible();
}

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const menu of ["Language", "Theme"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`Réglages with the ${menu} menu open has no axe violation, ${theme}`, async ({
        page,
      }) => {
        await openSettings(page, theme);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        await row(page, menu).click();
        await expect(page.getByRole("listbox")).toBeVisible();
        await expectNoAxeViolations(page);
      });
    }
  }
});

// A weigh-in the server refuses, then Réglages, where it is listed.
async function refusedWeighIn(
  page: Page,
  reason: Parameters<typeof refuseChanges>[1] = "refused",
  theme?: "light" | "dark",
) {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page);
  await refuseChanges(page, reason);
  await page.goto("/");
  await page.getByRole("button", { name: /^Weigh-in/ }).click();
  const sheet = page.getByRole("dialog", { name: "Weigh-in" });
  await sheet.getByRole("textbox", { name: "Weight" }).fill("80.5");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("An entry was refused.")).toBeVisible();
  await page.goto("/settings");
  const list = page.getByRole("list", { name: "Refused entries" });
  await expect(list).toBeVisible();
  return list;
}

test.describe("accessibility of the refused entries", () => {
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`Réglages with refused entries has no axe violation, ${theme}`, async ({ page }) => {
      const list = await refusedWeighIn(page, "refused", theme);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(list.getByRole("button", { name: "Clear the list" })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});

test.describe("accessibility of the account rows", () => {
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`Réglages signed in has no axe violation, ${theme}`, async ({ page }) => {
      await openSettings(page, theme);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expect(signOut(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the sign-out action sheet has no axe violation, ${theme}`, async ({ page }) => {
      await openSettings(page, theme);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await signOut(page).click();
      await expect(page.getByRole("dialog", { name: "Sign out?" })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});

// The destructive token as the browser resolves it in the current theme.
const destructive = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--destructive)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });

// Every element painted in that colour, as text or as fill, by its text.
const paintedIn = (page: Page, color: string) =>
  page.evaluate(
    (red) =>
      [...document.querySelectorAll<HTMLElement>("body *")]
        .filter((el) => {
          const style = getComputedStyle(el);
          return style.color === red || style.backgroundColor === red;
        })
        .map((el) => el.textContent.trim()),
    color,
  );

test("the profile row is 72 px with a 48 px avatar", async ({ page }) => {
  await openSettings(page);
  await settled(page);
  const profile = page.getByRole("link", { name: /^Ada Profile/ });
  const box = (await profile.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(72);
  const avatar = (await profile.locator("[data-slot=row-leading]").boundingBox())!;
  expect([avatar.width, avatar.height]).toEqual([48, 48]);
  await expect(profile.locator("[data-slot=row-leading]")).toHaveText("A");
  await expect(profile.locator("[data-slot=row-leading] > *")).toHaveCSS(
    "border-radius",
    /9999px|50%/,
  );
  await expect(profile.getByText("Ada", { exact: true })).toHaveCSS("font-size", "17px");
});

test("the sign-out label sits centred alone in its group", async ({ page }) => {
  await openSettings(page);
  await settled(page);
  const row = signOut(page);
  const label = row.getByText("Sign out");
  const rowBox = (await row.boundingBox())!;
  const labelBox = (await label.boundingBox())!;
  expect(
    Math.abs(labelBox.x + labelBox.width / 2 - (rowBox.x + rowBox.width / 2)),
  ).toBeLessThanOrEqual(1);
  await expect(page.getByRole("list").filter({ has: row }).getByRole("listitem")).toHaveCount(1);
  await expect(label).toHaveCSS("color", await destructive(page));
  await expect(row.locator("svg")).toHaveCount(0);
});

test("red marks only the sign-out row and its action", async ({ page }) => {
  await openSettings(page);
  await settled(page);
  await expect(signOut(page)).toBeVisible();
  const red = await destructive(page);
  expect(await paintedIn(page, red)).toEqual(["Sign out"]);
  await signOut(page).click();
  const sheet = page.getByRole("dialog", { name: "Sign out?" });
  await expect(sheet).toBeVisible();
  await settled(page);
  expect(await paintedIn(page, red)).toEqual(["Sign out", "Sign out"]);
  await expect(sheet.getByRole("button", { name: "Sign out" })).toHaveCSS("color", red);
});

test("a menu opens from the keyboard and gives the focus back to its row", async ({ page }) => {
  await openSettings(page, "light");
  const theme = row(page, "Theme");
  const menu = page.getByRole("listbox");

  await theme.focus();
  await page.keyboard.press("Enter");
  // The menu opens on the current choice, then the arrow moves to the next one.
  await expect(page.getByRole("option", { name: "Light" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "Dark" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menu).toBeHidden();
  await expect(theme).toHaveAccessibleName("Theme Dark");
  await expect(theme).toBeFocused();

  await page.keyboard.press("Space");
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(theme).toBeFocused();

  await theme.click();
  await expect(menu).toBeVisible();
  const title = (await page.locator("main h1").boundingBox())!;
  await page.mouse.click(title.x + 4, title.y + title.height / 2);
  await expect(menu).toBeHidden();
  await expect(theme).toBeFocused();
});

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 780 } });

  test("a long reason wraps, never cut, at 360 px", async ({ page }) => {
    const list = await refusedWeighIn(page, "plan_shrank");
    await settled(page);
    const detail = list.getByText(/^Fewer exercises than the stored session/);
    const box = await detail.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        scroll: el.scrollWidth,
        client: el.clientWidth,
        overflow: style.textOverflow,
        height: el.getBoundingClientRect().height,
        line: parseFloat(style.lineHeight),
      };
    });
    expect(box.scroll).toBeLessThanOrEqual(box.client);
    expect(box.overflow).not.toBe("ellipsis");
    expect(box.height).toBeGreaterThan(box.line * 1.5);
    const header = (await list.getByRole("listitem").first().boundingBox())!;
    const profile = (await page.getByRole("link", { name: /^Ada/ }).boundingBox())!;
    expect(header.y).toBeGreaterThan(profile.y + profile.height);
    const preferences = (await page.getByRole("list", { name: "Preferences" }).boundingBox())!;
    expect(header.y).toBeLessThan(preferences.y);
  });

  test("the preference rows follow the kit at 360 px", async ({ page }) => {
    await openSettings(page);
    await settled(page);
    for (const name of ["Language", "Theme"] as const) {
      const trigger = row(page, name);
      const box = (await trigger.boundingBox())!;
      expect(box.height, name).toBeGreaterThanOrEqual(52);
      const square = (await trigger.locator("[data-slot=row-icon]").boundingBox())!;
      expect([square.width, square.height], name).toEqual([28, 28]);
      const chevron = trigger.locator("[data-slot=row-chevron]");
      await expect(chevron).toHaveClass(/lucide-chevron-down/);
      const value = (await trigger.locator("[data-slot=select-value]").boundingBox())!;
      const arrow = (await chevron.boundingBox())!;
      expect(value.x + value.width, name).toBeLessThanOrEqual(arrow.x);
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});

test.describe("Compléments", () => {
  const openSupplements = async (page: Page) => {
    await fakeServer(page);
    await page.goto("/settings/supplements");
    await expect(page.getByRole("heading", { level: 1, name: "My supplements" })).toBeVisible();
  };

  test.describe("at 390 px", () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test("the Compléments empty state is left-aligned", async ({ page }) => {
      await openSupplements(page);
      await settled(page);
      const sentence = page.getByText("No supplements on your list yet.");
      // The grouped card that holds it: its text starts 16 px in.
      const card = sentence.locator("xpath=ancestor::*[contains(@class, 'rounded-group')][1]");
      const cardBox = (await card.boundingBox())!;
      const sentenceBox = (await sentence.boundingBox())!;
      expect(Math.abs(sentenceBox.x - (cardBox.x + 16))).toBeLessThanOrEqual(1);
      expect(await sentence.evaluate((el) => getComputedStyle(el).textAlign)).toMatch(
        /^(left|start)$/,
      );
    });
  });

  test.describe("at 360 px", () => {
    test.use({ viewport: { width: 360, height: 780 } });
    test("suggestion chips are 44 px and wrap at 360 px", async ({ page }) => {
      await openSupplements(page);
      await settled(page);
      const chips = page.getByRole("list").last().getByRole("button");
      await expect(chips.first()).toBeVisible();
      for (const chip of await chips.all())
        expect((await chip.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const tops = new Set(
        await Promise.all((await chips.all()).map(async (c) => (await c.boundingBox())!.y)),
      );
      expect(tops.size).toBeGreaterThan(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBe(0);
    });
  });

  test("no red on Compléments", async ({ page }) => {
    await openSupplements(page);
    await page.getByRole("button", { name: "Iron" }).click();
    await page.getByRole("button", { name: "More for Iron" }).click();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
    await settled(page);
    expect(await paintedIn(page, await destructive(page))).toEqual([]);
  });
});
