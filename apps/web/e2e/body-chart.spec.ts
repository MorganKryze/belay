import { addDays } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// On the real clock, in English: "today" is the real date in Paris, the fixtures built from it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

// Six weeks of weigh-ins drifting down from 81.5 kg, a creatine course ticked three days ago, and
// two annotations two days apart, early in the month shown, away from the course's label.
async function openBody(page: Page) {
  const day = today();
  const rows = Array.from({ length: 42 }, (_, i) => ({
    date: addDays(day, -i),
    weightKg: Math.round((80 + i * 0.035 + (i % 3) * 0.2) * 10) / 10,
  }));
  const annotation = (id: string, date: string, type: string): Change =>
    ({ kind: "annotation", id, field: "fields", date, type, label: null, at: AT }) as Change;
  const changes: Change[] = [
    { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
    { kind: "supplementLog", supplementId: CREATINE, date: addDays(day, -3), taken: true, at: AT },
    annotation("0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90", addDays(day, -22), "diet_break"),
    annotation("0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91", addDays(day, -20), "deload"),
  ];
  await fakeServer(page, { rows, changes });
  await page.goto("/body");
  await expect(page.locator(".launch")).toBeHidden();
  const chart = page.getByRole("img", { name: /^Weigh-ins from/ });
  await expect(chart).toBeVisible();
  return chart;
}

// A token's colour as the browser computes it, to compare with an element's fill or stroke.
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

const boxOf = async (l: Locator) => (await l.boundingBox())!;

for (const width of [360, 390, 1280]) {
  test(`the chart draws at its own width: no scaling, ticks and dates 12 px (${width} px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const chart = await openBody(page);
    const drawn = await chart.evaluate((svg) => ({
      viewBox: (svg as SVGSVGElement).viewBox.baseVal.width,
      box: svg.getBoundingClientRect().width,
      height: svg.getBoundingClientRect().height,
    }));
    expect(Math.abs(drawn.viewBox - drawn.box)).toBeLessThanOrEqual(1);
    expect(drawn.height).toBeCloseTo(180, 0);
    // Every text but the creatine label (11.5 px) is 12 px: ticks, dates, names, last average.
    const sizes = await chart
      .locator("text:not([data-slot=band-label])")
      .evaluateAll((all) => all.map((t) => getComputedStyle(t).fontSize));
    expect(sizes.length).toBeGreaterThan(5);
    expect(new Set(sizes)).toEqual(new Set(["12px"]));
    await expect(chart.locator("text[data-slot=band-label]")).toHaveCSS("font-size", "11.5px");
  });
}

test("the last average is written in the line's colour inside the card", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 900 });
  const chart = await openBody(page);
  const last = chart.locator("text[data-slot=last-average]");
  await expect(last).toHaveText(/^\d+\.\d$/);
  await expect(last).toHaveCSS("fill", await tokenColor(page, "--chart-line"));
  await expect(last).toHaveCSS("font-weight", "700");
  const card = await boxOf(page.locator("div.rounded-card", { has: chart }));
  const text = await boxOf(last);
  expect(text.x).toBeGreaterThanOrEqual(card.x);
  expect(text.x + text.width).toBeLessThanOrEqual(card.x + card.width);
  expect(text.y).toBeGreaterThanOrEqual(card.y);
  expect(text.y + text.height).toBeLessThanOrEqual(card.y + card.height);
});

test("annotation names are 12 px, 600, in the text ink with the card's halo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const chart = await openBody(page);
  const names = chart.locator("text[data-level]");
  await expect(names).toHaveCount(2);
  const ink = await tokenColor(page, "--foreground");
  const halo = await tokenColor(page, "--card");
  for (const name of await names.all()) {
    await expect(name).toHaveCSS("font-size", "12px");
    await expect(name).toHaveCSS("font-weight", "600");
    await expect(name).toHaveCSS("fill", ink);
    await expect(name).toHaveCSS("stroke", halo);
    await expect(name).toHaveCSS("stroke-width", "3px");
    await expect(name).toHaveCSS("paint-order", "stroke");
  }
});

test("the second of two close names sits in the strip above the plot, clear of every dot", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 });
  const chart = await openBody(page);
  await expect(chart.locator("text[data-level=bottom]")).toHaveText("Break");
  const raised = chart.locator("text[data-level=top]");
  await expect(raised).toHaveText("Deload");
  const seen = await chart.evaluate((svg) => {
    const box = (e: Element) => e.getBoundingClientRect();
    const name = box(svg.querySelector("text[data-level=top]")!);
    const gridTop = Math.min(
      ...[...svg.querySelectorAll("line:not([stroke-dasharray])")].map((l) => box(l).y),
    );
    const meets = [...svg.querySelectorAll("circle")].filter((c) => {
      const b = box(c);
      return b.x < name.right && b.right > name.x && b.y < name.bottom && b.bottom > name.y;
    }).length;
    return { bottom: name.bottom, gridTop, meets };
  });
  // The text box runs a hair under the baseline (descenders): half a pixel of slack.
  expect(seen.bottom).toBeLessThanOrEqual(seen.gridTop + 0.5);
  expect(seen.meets).toBe(0);
});

test("a period change redraws the chart with no animation", async ({ page }) => {
  const chart = await openBody(page);
  const before = await chart.evaluate((svg) => svg.getAttribute("aria-label"));
  const seen = await page.evaluate(async () => {
    const radio = [...document.querySelectorAll<HTMLElement>("[role=radio]")].find(
      (r) => r.textContent === "3 months",
    )!;
    radio.click();
    await new Promise((r) => requestAnimationFrame(r));
    const svg = document.querySelector("svg[role=img][aria-label^='Weigh-ins from']")!;
    return {
      label: svg.getAttribute("aria-label"),
      animations: document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return target instanceof Node && svg.contains(target);
      }).length,
    };
  });
  expect(seen.label).not.toBe(before);
  expect(seen.animations).toBe(0);
});
