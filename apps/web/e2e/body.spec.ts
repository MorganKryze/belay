import { addDays } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";

// On the real clock, in English: "today" is the real date in Paris.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
const DELOAD = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const TRIP = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
const parisToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
// A weigh-in at 80.4 kg on each of the last `count` days: a flat week once there are 21.
const flat = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ date: addDays(parisToday(), -i), weightKg: 80.4 }));
// Creatine ticked today: a course runs through the chart's period.
const creatine = (): Change[] => [
  { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
  { kind: "supplementLog", supplementId: CREATINE, date: parisToday(), taken: true, at: AT },
];

async function openBody(page: Page, rows = flat(21), changes: Change[] = []) {
  await fakeServer(page, { rows, changes });
  await page.goto("/body");
  await expect(page.locator(".launch")).toBeHidden();
}

const figureCard = (page: Page) => page.getByRole("region", { name: "7-day average" });
const chart = (page: Page) => page.getByRole("img", { name: /^Weigh-ins from/ });
// The chart's card: the legend's creatine swatch sits in a row of the card's first line.
const swatch = (page: Page) => page.getByText("Creatine", { exact: true }).locator("i");
const chartCard = (page: Page) => swatch(page).locator("xpath=../../..");

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

async function expectCardSurface(card: Locator, dark: boolean) {
  await expect(card).toHaveCSS("border-top-width", dark ? "1px" : "0px");
  if (dark) await expect(card).toHaveCSS("box-shadow", "none");
  else await expect(card).not.toHaveCSS("box-shadow", "none");
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`Corps opens on Accueil's figure: 50 px bold tabular, a 17 px unit, on the card surface, ${scheme}`, async ({
      page,
    }) => {
      await openBody(page);
      const card = figureCard(page);
      await expect(card).toContainText("80.4 kg");
      await expect(card.getByRole("heading", { name: "7-day average", level: 2 })).toHaveCSS(
        "font-size",
        "13px",
      );
      const figure = card.locator("[data-slot=trend-figure]");
      await expect(figure).toHaveCSS("font-size", "50px");
      await expect(figure).toHaveCSS("font-weight", "700");
      await expect(figure).toHaveCSS("font-variant-numeric", "tabular-nums");
      await expect(figure).toHaveCSS("letter-spacing", "-1.5px");
      await expect(figure.getByText("kg", { exact: true })).toHaveCSS("font-size", "17px");
      await expect(card.getByRole("link")).toHaveCount(0);
      await expectCardSurface(card, scheme === "dark");
    });

    test(`the chart's card is on the card surface and its creatine swatch is the band, ${scheme}`, async ({
      page,
    }) => {
      await openBody(page, flat(21), creatine());
      await expect(chart(page)).toBeVisible();
      await expectCardSurface(chartCard(page), scheme === "dark");
      const mark = swatch(page);
      await expect(mark).toHaveCSS("width", "10px");
      await expect(mark).toHaveCSS("height", "10px");
      await expect(mark).toHaveCSS("background-color", await tokenColor(page, "--primary-soft"));
      const ink = await tokenColor(page, "--primary-ink");
      const ring = await mark.evaluate((el) => getComputedStyle(el).boxShadow);
      expect(ring).toContain(ink);
      expect(ring).toContain("inset");
      expect(ring).toContain("1px");
    });
  });
}

test("the period sits under the figure card and over the chart card", async ({ page }) => {
  await openBody(page, flat(21), creatine());
  await expect(chart(page)).toBeVisible();
  const card = (await figureCard(page).boundingBox())!;
  const period = (await page.getByRole("radiogroup", { name: "Period" }).boundingBox())!;
  const chartBox = (await chartCard(page).boundingBox())!;
  expect(period.y).toBeGreaterThanOrEqual(card.y + card.height);
  expect(chartBox.y).toBeGreaterThanOrEqual(period.y + period.height);
});

test("the first days read in the figure card", async ({ page }) => {
  await openBody(page, flat(2));
  const card = figureCard(page);
  const heading = card.locator("h3");
  await expect(heading).toHaveText(/more weigh-ins? this week/);
  await expect(heading).toHaveCSS("font-size", "15px");
  await expect(heading).toHaveCSS("font-weight", "600");
  await expect(card.locator("[data-slot=trend-figure]")).toHaveText("—");
  await expect(card).toContainText("A single day's weight varies too much");
});

test("the creatine sentence sits under a hairline in the figure card", async ({ page }) => {
  await openBody(page, flat(21), creatine());
  const note = figureCard(page).getByText(/rises by 1 to 2\skg of water/);
  await expect(note).toHaveCSS("border-top-width", "1px");
  await expect(note).toHaveCSS("border-top-style", "solid");
  await expect(note).toHaveCSS("font-size", "13px");
});

test("a flat week reads stable on Accueil and on Corps", async ({ page }) => {
  await fakeServer(page, { rows: flat(21) });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  const home = page.getByRole("link", { name: /^7-day average/ });
  await expect(home).toContainText("stable last week");
  await expect(home.locator("b")).toHaveText("stable");
  await home.tap();
  await expect(page).toHaveURL(/\/body$/);
  await expect(figureCard(page)).toContainText("stable last week");
  await expect(figureCard(page).locator("b")).toHaveText("stable");
});

for (const width of [360, 390, 1280]) {
  test(`Corps has nothing scrolling sideways at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openBody(page, flat(21), creatine());
    await expect(chart(page)).toBeVisible();
    await settled(page);
    const wide = await page.evaluate(() => {
      const root = document.documentElement;
      const out = [...document.querySelectorAll("main *")]
        .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 0.5)
        .map((el) => `${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().right)}`);
      if (root.scrollWidth > root.clientWidth) out.push(`html ${root.scrollWidth}`);
      return out;
    });
    expect(wide).toEqual([]);
  });
}

// Two annotations of the month: a deload three days ago, a note named by its text ten days ago.
const annotations = (): Change[] => [
  {
    kind: "annotation",
    id: DELOAD,
    field: "fields",
    date: addDays(parisToday(), -3),
    type: "deload",
    label: null,
    at: AT,
  },
  {
    kind: "annotation",
    id: TRIP,
    field: "fields",
    date: addDays(parisToday(), -10),
    type: "note",
    label: "voyage à Lisbonne",
    at: AT,
  },
];
const log = (page: Page) => page.getByRole("region", { name: "Log" });
const notes = (page: Page) => page.getByRole("region", { name: "Annotations" });

async function expectGestureRow(row: Locator) {
  const box = (await row.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(56);
  return box;
}

test("the Log rows are 56 px with 28 px icon squares and 16 px chevrons", async ({ page }) => {
  await openBody(page, flat(21));
  const rows = log(page).getByRole("button");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAccessibleName(/^Weigh-in 80\.4\skg$/);
  await expect(rows.nth(1)).toHaveAccessibleName("Measurements not entered yet");
  await expect(rows.nth(2)).toHaveAccessibleName("Annotation deload week, break or note");
  for (const row of await rows.all()) {
    await expectGestureRow(row);
    const square = row.locator("> span[aria-hidden]").first();
    await expect(square).toHaveCSS("width", "28px");
    await expect(square).toHaveCSS("height", "28px");
    const chevron = row.locator("svg.lucide-chevron-right");
    await expect(chevron).toHaveCSS("width", "16px");
    await expect(chevron).toHaveCSS("height", "16px");
  }
  // The name 15 px semibold over a 13 px status.
  await expect(rows.nth(2).getByText("Annotation", { exact: true })).toHaveCSS(
    "font-weight",
    "600",
  );
  await expect(rows.nth(2).getByText("deload week, break or note")).toHaveCSS("font-size", "13px");
});

test("the Annotations rows are 56 px and open their sheet", async ({ page }) => {
  await openBody(page, flat(21), annotations());
  const rows = notes(page).getByRole("button");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAccessibleName(/^Deload /);
  await expect(rows.nth(1)).toHaveAccessibleName(/^voyage à Lis… Note · /);
  for (const row of await rows.all()) await expectGestureRow(row);
  await rows.nth(1).tap();
  const sheet = page.getByRole("dialog", { name: "Annotation" });
  await expect(sheet.getByRole("radio", { name: "Note" })).toHaveAttribute("aria-checked", "true");
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} lists`, () => {
    test.use({ colorScheme: scheme });

    test(`Corps with creatine, two annotations and its lists has no axe violation, ${scheme}`, async ({
      page,
    }) => {
      await openBody(page, flat(21), [...creatine(), ...annotations()]);
      await expect(notes(page).getByRole("button")).toHaveCount(2);
      await expect(log(page).getByRole("button")).toHaveCount(3);
      await expectNoAxeViolations(page);
    });
  });
}

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the bottom of Corps has nothing scrolling sideways at 360 px in French", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await openBody(page, flat(21), [...creatine(), ...annotations()]);
    const list = page.getByRole("region", { name: "Annotations" });
    await expect(list.getByRole("button")).toHaveCount(2);
    await expect(page.getByRole("region", { name: "Saisir" })).toContainText(
      "semaine allégée, pause ou note",
    );
    await page.getByRole("region", { name: "Historique" }).scrollIntoViewIfNeeded();
    await settled(page);
    const wide = await page.evaluate(() => {
      const root = document.documentElement;
      const out = [...document.querySelectorAll("main *")]
        .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 0.5)
        .map((el) => `${el.tagName.toLowerCase()} ${Math.round(el.getBoundingClientRect().right)}`);
      if (root.scrollWidth > root.clientWidth) out.push(`html ${root.scrollWidth}`);
      return out;
    });
    expect(wide).toEqual([]);
    // Each row of the two lists keeps its status on one line.
    for (const row of await page
      .locator(
        "section[aria-labelledby=entries] button, section[aria-labelledby=annotations] button",
      )
      .all())
      expect((await row.boundingBox())!.height).toBeLessThanOrEqual(64);
  });
});
