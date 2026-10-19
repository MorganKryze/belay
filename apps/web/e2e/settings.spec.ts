import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer, refuseChanges } from "./fake-server";

// Signed in as Ada, in English.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// Each row by its label; its name is the label then the value.
const row = (page: Page, name: string) =>
  page.getByRole("combobox", { name: new RegExp(`^${name} · `) });

const signOut = (page: Page) => page.getByRole("button", { name: "Sign out" });

async function openSettings(page: Page, theme?: "light" | "dark") {
  if (theme) await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page);
  await page.goto("/settings");
  await expect(row(page, "Language")).toBeVisible();
}

test.describe("accessibility", () => {
  test.use({ reducedMotion: "reduce" });
  for (const menu of [
    "Language",
    "Theme",
    "Trend",
    "History",
    "Volume",
    "Range pill",
    "Weekly intake",
    "1RM",
    "Field sources",
  ] as const) {
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
  const list = page.getByRole("region", { name: "Refused entries" });
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
  await expect(theme).toHaveAccessibleName("Theme · Dark");
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

// The menu gives the focus back to its row as it closes. Safari on a phone counts that focus as
// visible even after a tap, which Chromium does not: the test asks for visible focus as Safari
// gives it. The ring belongs to the keyboard only.
test("a choice tapped in a menu leaves its row without a ring, a key press brings rings back", async ({
  page,
}) => {
  await openSettings(page, "light");
  const paused = page.getByRole("combobox", { name: /^Paused · / });
  await paused.tap();
  await page.getByRole("option", { name: "Rest continues" }).tap();
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(paused).toHaveAccessibleName("Paused · Rest continues");
  await expect(paused).toBeFocused();
  await paused.evaluate((el: HTMLElement) => {
    el.blur();
    el.focus({ focusVisible: true } as FocusOptions);
  });
  expect(await paused.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
  await expect(paused).toHaveCSS("outline-style", "none");

  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toHaveCSS("outline-style", "solid");
});

test.describe("at 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });

  // An open menu ends above or below a line of text, never across it, which would leave half
  // letters showing under its edge. The page is inert behind the menu, so it is found by CSS.
  for (const theme of ["light", "dark"] as const) {
    for (const menu of ["Language", "Theme"] as const) {
      test(`the ${menu} menu never ends across a line of text, ${theme}`, async ({ page }) => {
        await openSettings(page, theme);
        await expect(signOut(page)).toBeVisible();
        await settled(page);
        await row(page, menu).click();
        const list = page.getByRole("listbox");
        await expect(list).toBeVisible();
        await settled(page);
        const box = (await list.boundingBox())!;
        const bottom = box.y + box.height;
        const lines = page.locator("main span", { hasText: /^(Sign out|Supplements)$/ });
        await expect(lines).toHaveCount(2);
        for (const line of await lines.all()) {
          const text = (await line.boundingBox())!;
          const across = bottom > text.y && bottom < text.y + text.height;
          expect(across, `${await line.textContent()} at ${text.y}, menu ends at ${bottom}`).toBe(
            false,
          );
        }
      });
    }
  }
});

// The page's end: sign-out and the version close Réglages, reached at the end of the scroll.
// Réglages may outgrow one screen; the version line stays last, under the sign-out group.
// A build made outside a release shows its version as plain text, without the notes link.
const versionLine = (page: Page) => page.locator("main > section p", { hasText: /^Belay / });
const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
const signOutCard = (page: Page) =>
  signOut(page).locator("xpath=ancestor::*[contains(@class, 'rounded-group')][1]");

// Signed out, the page fits: the version line sits on the shell column's bottom padding.
const columnPadding = (page: Page) =>
  page
    .locator("main")
    .evaluate((main) => parseFloat(getComputedStyle(main.parentElement!).paddingBottom));

async function expectAtTheBottom(page: Page) {
  const version = await box(versionLine(page));
  const { inner, scroll } = await page.evaluate(() => ({
    inner: innerHeight,
    scroll: document.documentElement.scrollHeight,
  }));
  expect(
    Math.abs(version.y + version.height - (inner - (await columnPadding(page)))),
  ).toBeLessThanOrEqual(1);
  expect(scroll).toBe(inner);
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test.describe(`at ${viewport.width} × ${viewport.height}`, () => {
    test.use({ viewport, reducedMotion: "reduce" });
    test("sign-out and the version close the page, reachable at the end of the scroll", async ({
      page,
    }) => {
      await openSettings(page);
      await expect(signOut(page)).toBeVisible();
      await settled(page);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(versionLine(page)).toBeInViewport();
      const version = await box(versionLine(page));
      const card = await box(signOutCard(page));
      expect(Math.abs(version.y - (card.y + card.height) - 16)).toBeLessThanOrEqual(1);
      const last = await page
        .locator("main > section")
        .evaluate((section) => section.lastElementChild!.lastElementChild!.textContent);
      expect(last).toMatch(/^Belay /);
    });
  });
}

test.describe("on a page taller than the screen", () => {
  test.use({ viewport: { width: 360, height: 560 }, reducedMotion: "reduce" });
  test("the sign-out group keeps 24 px under the group above, the version last", async ({
    page,
  }) => {
    await refusedWeighIn(page);
    await expect(signOut(page)).toBeVisible();
    await settled(page);
    const tracking = await box(
      page
        .getByRole("region", { name: "Tracking" })
        .locator("xpath=./*[contains(@class, 'rounded-group')]"),
    );
    const card = await box(signOutCard(page));
    expect(card.y - (tracking.y + tracking.height)).toBeGreaterThanOrEqual(24 - 0.5);
    const version = await box(versionLine(page));
    expect(version.y).toBeGreaterThan(card.y + card.height);
    const last = await page
      .locator("main > section")
      .evaluate((section) => section.lastElementChild!.lastElementChild!.textContent);
    expect(last).toMatch(/^Belay /);
  });
});

// Five preference sections outgrow 844 px: the check needs a screen the signed-out page fits.
test.describe("signed out at 390 × 932", () => {
  test.use({ viewport: { width: 390, height: 932 }, reducedMotion: "reduce" });
  test("signed out, the version line sits alone at the bottom", async ({ page }) => {
    await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
    await page.goto("/settings");
    await expect(row(page, "Language")).toBeVisible();
    await expect(versionLine(page)).toBeVisible();
    await settled(page);
    await expect(signOut(page)).toHaveCount(0);
    await expectAtTheBottom(page);
  });
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
    const preferences = (await page.getByRole("region", { name: "General" }).boundingBox())!;
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

  // Each section's rows with every value they can show; the language row shows its current one,
  // since picking the other changes the labels.
  for (const [locale, sections] of [
    [
      "en-US",
      [
        [
          "General",
          [
            ["Language", "English"],
            ["Theme", "System", "Light", "Dark"],
          ],
        ],
        ["Home", [["Trend", "Shown", "Hidden"]]],
        [
          "Sessions",
          [
            ["Paused", "Everything stops", "Rest continues"],
            ["History", "With activities", "Sessions only"],
            ["Volume", "Shown", "Hidden"],
          ],
        ],
        [
          "Body",
          [
            ["Range pill", "Shown", "Hidden"],
            ["Weekly intake", "Shown", "Hidden"],
          ],
        ],
        [
          "Tools",
          [
            ["1RM", "Two formulas", "Epley only"],
            ["Field sources", "Shown", "Hidden"],
          ],
        ],
      ],
    ],
    [
      "fr-FR",
      [
        [
          "Général",
          [
            ["Langue", "Français"],
            ["Thème", "Système", "Clair", "Sombre"],
          ],
        ],
        ["Accueil", [["Tendance", "Affichée", "Masquée"]]],
        [
          "Séances",
          [
            ["En pause", "Tout s'arrête", "Le repos continue"],
            ["Historique", "Avec activités", "Séances seules"],
            ["Volume", "Affiché", "Masqué"],
          ],
        ],
        [
          "Corps",
          [
            ["Pastille", "Affichée", "Masquée"],
            ["Apports", "Affichés", "Masqués"],
          ],
        ],
        [
          "Outils",
          [
            ["1RM", "Deux formules", "Epley seule"],
            ["Origine des champs", "Affichée", "Masquée"],
          ],
        ],
      ],
    ],
  ] as const) {
    test.describe(locale, () => {
      test.use({ locale });
      test(`the sections come in order and every row holds on one line at 360 px, ${locale}`, async ({
        page,
      }) => {
        await fakeServer(page);
        await page.goto("/settings");
        await expect(page.locator(".launch")).toBeHidden();
        await settled(page);
        const headings = await page.locator("main h2").allTextContents();
        expect(headings.slice(0, sections.length)).toEqual(sections.map(([s]) => s));
        // Height over line height, rounded: 1 is a single line.
        const measure = (el: ReturnType<Page["locator"]>) =>
          el.evaluate((n) => {
            const r = n.getBoundingClientRect();
            return {
              top: r.top,
              right: r.right,
              left: r.left,
              lines: Math.round(r.height / parseFloat(getComputedStyle(n).lineHeight)),
            };
          });
        for (const [section, rows] of sections) {
          const region = page.getByRole("region", { name: section });
          for (const [label, ...values] of rows) {
            const trigger = region.getByRole("combobox", {
              name: new RegExp(`^${label} · `),
            });
            for (const v of values) {
              if (v !== values[0]) {
                await trigger.click();
                await page.getByRole("option", { name: v }).click();
                await expect(page.getByRole("listbox")).toBeHidden();
              }
              const what = `${section} · ${label} · ${v}`;
              await expect(trigger).toHaveAccessibleName(`${label} · ${v}`);
              const name = await measure(trigger.getByText(label, { exact: true }));
              const value = await measure(trigger.locator("[data-slot=select-value]"));
              expect(name.lines, what).toBe(1);
              expect(value.lines, what).toBe(1);
              expect(Math.abs(value.top - name.top), what).toBeLessThanOrEqual(2);
              expect(value.left, what).toBeGreaterThan(name.right);
            }
          }
        }
      });
    });
  }
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

    test("the add field, its label and the suggestions share one left edge", async ({ page }) => {
      await openSupplements(page);
      await settled(page);
      const edges = await Promise.all(
        [
          page.getByText("Supplement name", { exact: true }),
          page.getByRole("textbox", { name: "Supplement name" }),
          page.getByRole("heading", { name: "Suggestions" }),
          page.getByRole("list").last().getByRole("button").first(),
        ].map(async (el) => (await el.boundingBox())!.x),
      );
      for (const x of edges) expect(Math.abs(x - edges[1]!)).toBeLessThanOrEqual(1);
      await expect(page.getByRole("heading", { name: "Add" })).toHaveCount(0);
    });

    // Rings go away after a tap, but a text field keeps its own: it shows where the typing goes.
    test("a tapped text field keeps its focus ring", async ({ page }) => {
      await openSupplements(page);
      const field = page.getByRole("textbox", { name: "Supplement name" });
      await field.tap();
      await expect(field).toBeFocused();
      await expect(field).toHaveCSS("outline-style", "solid");
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

test.describe("Profil", () => {
  // The bottom border each direct child of a card draws, in px.
  const hairlines = (card: ReturnType<Page["locator"]>) =>
    card.evaluate((el) =>
      [...el.children].map((child) => parseFloat(getComputedStyle(child).borderBottomWidth)),
    );

  test("the range card draws no hairline, the facts card keeps one between its rows", async ({
    page,
  }) => {
    await fakeServer(page);
    await page.goto("/settings/profile");
    const range = page.getByRole("region", { name: "Your loss range" });
    await expect(range.getByText("At least")).toBeVisible();
    const card = (section: typeof range) =>
      section.locator("xpath=./*[contains(@class, 'rounded-group')]");
    const widths = await hairlines(card(range));
    expect(widths).toEqual(widths.map(() => 0));
    const facts = await hairlines(card(page.getByRole("region", { name: "Your body" })));
    expect(facts.slice(0, -1).every((width) => width > 0)).toBe(true);
  });
});
