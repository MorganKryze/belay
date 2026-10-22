import { addDays } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// On the real clock, in English: "today" is the real date in Paris, the fixtures built from it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const AT = "2026-10-01T06:30:00.000Z";
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

// Five days weighed, today crowded with every part; two days before them with a waist or an
// intake alone, so the list holds rows with and without a weigh-in.
async function openBody(page: Page) {
  const day = today();
  const rows = Array.from({ length: 5 }, (_, i) => ({
    date: addDays(day, -i),
    weightKg: 80 + i * 0.3,
  }));
  const changes: Change[] = [
    { kind: "intake", date: day, field: "kcal", value: 2100, at: AT },
    { kind: "intake", date: day, field: "protein", value: 140, at: AT },
    { kind: "measure", date: day, field: "waist", value: 82, at: AT },
    { kind: "measure", date: day, field: "neck", value: 39.5, at: AT },
    { kind: "measure", date: day, field: "hip", value: 98, at: AT },
    { kind: "measure", date: addDays(day, -5), field: "waist", value: 83, at: AT },
    { kind: "intake", date: addDays(day, -6), field: "kcal", value: 1800, at: AT },
  ];
  await fakeServer(page, { rows, changes });
  await page.goto("/body");
  await expect(page.locator(".launch")).toBeHidden();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("listitem")).toHaveCount(7);
  return history;
}

// A token's colour as the browser computes it, to compare with an element's colour.
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

for (const scheme of ["light", "dark"] as const) {
  test(`History is one grouped list of 56 px rows on the group surface, ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const history = await openBody(page);
    await expect(history.getByRole("list")).toHaveCount(1);
    const list = history.getByRole("list");
    const card = await list.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        shadow: s.boxShadow,
        border: s.borderTopWidth,
        radius: s.borderTopLeftRadius,
        bg: s.backgroundColor,
      };
    });
    expect(card.radius).not.toBe("0px");
    expect(card.bg).toBe(
      await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.backgroundColor = "var(--surface)";
        document.body.append(probe);
        const bg = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return bg;
      }),
    );
    if (scheme === "light") expect(card.shadow).not.toBe("none");
    else {
      expect(card.border).toBe("1px");
      expect(card.shadow).toBe("none");
    }
    const items = await list.getByRole("listitem").evaluateAll((lis) =>
      lis.map((li) => ({
        h: li.firstElementChild!.getBoundingClientRect().height,
        line: getComputedStyle(li).borderBottomWidth,
      })),
    );
    for (const item of items) expect(item.h).toBeGreaterThanOrEqual(56);
    // A hairline between two rows, none under the last.
    expect(items.map((i) => i.line)).toEqual([...Array(6).fill("1px"), "0px"]);
  });
}

test("weights line up at the right, in the text ink, with tabular figures", async ({ page }) => {
  const history = await openBody(page);
  const fg = await tokenColor(page, "--foreground");
  const weights = history.locator("button b");
  await expect(weights).toHaveCount(5);
  const looks = await weights.evaluateAll((bs) =>
    bs.map((b) => {
      const s = getComputedStyle(b);
      return {
        right: b.getBoundingClientRect().right,
        color: s.color,
        numeric: s.fontVariantNumeric,
        weight: s.fontWeight,
      };
    }),
  );
  // An unweighed row's first line ends where a weight would: its spacer keeps the chevron's room.
  const unweighed = await history
    .getByRole("listitem")
    .last()
    .evaluate((li) => li.firstElementChild!.firstElementChild!.getBoundingClientRect().right);
  for (const look of looks) {
    expect(Math.abs(look.right - looks[0]!.right)).toBeLessThanOrEqual(1);
    expect(Math.abs(look.right - unweighed)).toBeLessThanOrEqual(1);
    expect(look.color).toBe(fg);
    expect(look.numeric).toBe("tabular-nums");
    expect(look.weight).toBe("600");
  }
  // The chevron sits in its 16 px column, after the weight.
  const chevron = await history
    .getByRole("button")
    .first()
    .locator("svg")
    .evaluate((svg) => svg.getBoundingClientRect());
  expect(chevron.width).toBe(16);
  expect(chevron.left).toBeGreaterThan(looks[0]!.right);
});

test("a crowded day wraps only between parts at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const history = await openBody(page);
  const parts = history.getByRole("button", { name: /^Today/ }).locator("span.whitespace-nowrap");
  await expect(parts).toHaveCount(5);
  const boxes = await parts.evaluateAll((spans) =>
    spans.map((s) => ({ rects: s.getClientRects().length, top: s.getBoundingClientRect().top })),
  );
  // Each part on one line of its own box; the five do not fit on one line at 360 px.
  for (const b of boxes) expect(b.rects).toBe(1);
  expect(new Set(boxes.map((b) => Math.round(b.top))).size).toBeGreaterThan(1);
});

test("History has nothing scrolling sideways at 360 px", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const history = await openBody(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBe(0);
  const wide = await history.evaluate((section) =>
    [section, ...section.querySelectorAll("*")]
      .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.tagName.toLowerCase() !== "svg")
      .map((el) => el.tagName),
  );
  expect(wide).toEqual([]);
});

test("a weighed day with no second line is one centred line, its weight still at the right", async ({
  page,
}) => {
  const history = await openBody(page);
  // Yesterday holds a weigh-in alone: its first line sits in the middle of its row, no band below.
  const row = history.getByRole("button", { name: /^Yesterday/ });
  const box = await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const line = el.firstElementChild!.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      gap: r.bottom - parseFloat(s.paddingBottom) - line.bottom,
      above: line.top - r.top - parseFloat(s.paddingTop),
      lines: el.querySelectorAll(":scope > span").length,
    };
  });
  expect(box.lines).toBe(1);
  expect(Math.abs(box.gap - box.above)).toBeLessThanOrEqual(1);
});

test("All lists the entries and annotations dated before the first weigh-in", async ({ page }) => {
  const day = today();
  await fakeServer(page, {
    rows: [{ date: day, weightKg: 80 }],
    changes: [
      { kind: "measure", date: addDays(day, -200), field: "waist", value: 84, at: AT },
      {
        kind: "annotation",
        id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90",
        field: "fields",
        date: addDays(day, -190),
        type: "deload",
        label: null,
        at: AT,
      } as Change,
    ],
  });
  await page.goto("/body");
  await expect(page.locator(".launch")).toBeHidden();
  const history = page.getByRole("region", { name: "History" });
  await expect(history.getByRole("listitem")).toHaveCount(1);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Annotations" }).getByText("Deload")).toBeVisible();
});
