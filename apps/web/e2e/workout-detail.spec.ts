import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// Wednesday 7 October 2026, 6 p.m. in Paris; only static checks here, so the clock stands still.
const NOW = new Date("2026-10-07T18:00:00+02:00");
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await fakeServer(page, { changes: PAST });
});

const A = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const C = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f02";
// A finished session `code`, its first exercise done `sets` times at 80 kg × 8.
function finished(
  workout: string,
  code: string,
  start: string,
  end: string,
  sets: number,
): Change[] {
  const plan = [...sessionByCode(code)!.slots];
  return [
    {
      kind: "workout",
      id: workout,
      field: "start",
      sessionCode: code,
      plan,
      startedAt: start,
      at: start,
    },
    ...Array.from({ length: sets }, (_, k): Change => ({
      kind: "set",
      id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c8${code.toLowerCase()}${String(10 + k)}`,
      workoutId: workout,
      field: "create",
      slotIndex: 0,
      position: 3 + k,
      exerciseId: plan[0]!.exerciseId,
      warmup: false,
      weightKg: 80,
      reps: 8,
      rir: 1,
      doneAt: start,
      at: start,
    })),
    { kind: "workout", id: workout, field: "ended", value: end, at: end },
  ];
}
// Session A on Monday, and session C, the longest title, on Tuesday.
const PAST: Change[] = [
  ...finished(A, "A", "2026-10-05T16:00:00.000Z", "2026-10-05T17:04:00.000Z", 12),
  ...finished(C, "C", "2026-10-06T16:00:00.000Z", "2026-10-06T17:10:00.000Z", 12),
];

async function open(page: Page, workout: string, title: string) {
  await page.goto(`/workouts/${workout}`);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
  await page.evaluate(() => document.fonts.ready);
}

const back = (page: Page) => page.locator("main").getByRole("link", { name: "History" });
const edit = (page: Page) => page.locator("main").getByRole("link", { name: "Edit" });
const compact = (page: Page) => page.locator("[data-compact-title]");

test("Edit sits at the right end of the top bar, at least 44 × 44, in the back link's ink", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, A, "Session A · Push");
  const box = (await edit(page).boundingBox())!;
  const bar = (await compact(page).locator("xpath=../..").boundingBox())!;
  expect(390 - (box.x + box.width)).toBeLessThanOrEqual(12);
  expect(box.y).toBeGreaterThanOrEqual(bar.y);
  expect(box.y + box.height).toBeLessThanOrEqual(bar.y + bar.height + 0.5);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  const color = (el: Element) => getComputedStyle(el).color;
  expect(await edit(page).evaluate(color)).toBe(await back(page).evaluate(color));
});

const foldBy200 = async (page: Page) => {
  await page.evaluate(() => window.scrollTo(0, 200));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(200);
};

test("the compact title stays centred between History and Edit once folded", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 480 });
  await open(page, A, "Session A · Push");
  await foldBy200(page);
  await expect(compact(page)).toHaveCSS("opacity", "1");
  const title = (await compact(page).boundingBox())!;
  const middle = await page.evaluate(() => document.documentElement.clientWidth / 2);
  expect(Math.abs(title.x + title.width / 2 - middle)).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 360, height: 480 });
  await open(page, C, "Session C · Glutes + light pull");
  await foldBy200(page);
  const long = (await compact(page).boundingBox())!;
  const left = (await back(page).boundingBox())!;
  const right = (await edit(page).boundingBox())!;
  expect(long.x).toBeGreaterThanOrEqual(left.x + left.width);
  expect(long.x + long.width).toBeLessThanOrEqual(right.x);
});

test("the past session has nothing scrolling sideways at 360, 390 and 1 280 px", async ({
  page,
}) => {
  for (const [width, height] of [
    [360, 740],
    [390, 844],
    [1280, 800],
  ] as const) {
    await page.setViewportSize({ width, height });
    await open(page, C, "Session C · Glutes + light pull");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBe(0);
  }
});

const bench = (page: Page) => page.getByRole("region", { name: "Barbell bench press" });

test("a set's number, load and RIR line up in three columns", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, A, "Session A · Push");
  const rows = await bench(page)
    .getByRole("listitem")
    .evaluateAll((items) =>
      items.map((li) => {
        const [, load, rir] = [...li.children].map((c) => c.getBoundingClientRect());
        return {
          height: li.getBoundingClientRect().height,
          loadLeft: load!.left,
          rirRight: rir!.right,
        };
      }),
    );
  expect(rows).toHaveLength(12);
  for (const row of rows) {
    expect(row.height).toBeGreaterThanOrEqual(40);
    expect(Math.abs(row.loadLeft - rows[0]!.loadLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(row.rirRight - rows[0]!.rirRight)).toBeLessThanOrEqual(1);
  }
  // The RIR closes the row at the right, 16 px in from the card's edge.
  const card = (await bench(page).boundingBox())!;
  expect(Math.abs(card.x + card.width - 16 - rows[0]!.rirRight)).toBeLessThanOrEqual(1);
  // Hairlines start under the name, 56 px in from the card's edge.
  const hairline = await bench(page)
    .getByRole("listitem")
    .nth(1)
    .evaluate((li) => {
      const before = getComputedStyle(li, "::before");
      return { left: before.left, height: before.height };
    });
  expect(hairline).toEqual({ left: "56px", height: "1px" });
});

test("each exercise card has a 56 px header with a 28 px tile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, A, "Session A · Push");
  const tile = bench(page).locator("[aria-hidden]").first();
  await expect(tile).toHaveText("1");
  const box = (await tile.boundingBox())!;
  expect(box.width).toBe(28);
  expect(box.height).toBe(28);
  const header = (await tile.locator("xpath=..").boundingBox())!;
  expect(header.height).toBeGreaterThanOrEqual(56);
  // The tile sits in the middle of its header.
  expect(Math.abs(box.y + box.height / 2 - (header.y + header.height / 2))).toBeLessThanOrEqual(1);
});

test("the delete row is red, centred, alone in its group at the page's end", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, A, "Session A · Push");
  const remove = page.getByRole("button", { name: "Delete this session" });
  const label = remove.locator("span");
  const red = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.color = "var(--destructive)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(label).toHaveCSS("color", red);
  const row = (await remove.boundingBox())!;
  const text = (await label.boundingBox())!;
  expect(Math.abs(text.x + text.width / 2 - (row.x + row.width / 2))).toBeLessThanOrEqual(1);
  expect(row.height).toBeGreaterThanOrEqual(44);
  const place = await remove.evaluate((el) => {
    const group = el.closest("section")!;
    return {
      rows: group.querySelectorAll("li").length,
      last: group.nextElementSibling === null,
      below: [...group.parentElement!.children].every(
        (other) =>
          other === group ||
          other.getBoundingClientRect().bottom <= group.getBoundingClientRect().top,
      ),
    };
  });
  expect(place).toEqual({ rows: 1, last: true, below: true });
});

const strip = (page: Page) => page.locator("main dl");

for (const theme of ["light", "dark"] as const) {
  test(`the strip's figures are 20 px bold tabular under 12 px labels, in three equal columns of one card, ${theme}`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, A, "Session A · Push");
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    const columns = await strip(page)
      .locator(":scope > div")
      .evaluateAll((divs) =>
        divs.map((div) => {
          const dt = getComputedStyle(div.querySelector("dt")!);
          const dd = getComputedStyle(div.querySelector("dd")!);
          const unit = div.querySelector("dd span");
          return {
            width: div.getBoundingClientRect().width,
            label: [dt.fontSize, dt.fontWeight],
            figure: [dd.fontSize, dd.fontWeight, dd.fontVariantNumeric, dd.letterSpacing],
            unit: unit && getComputedStyle(unit).fontSize,
          };
        }),
      );
    expect(columns).toHaveLength(3);
    for (const c of columns) {
      expect(c.label).toEqual(["12px", "600"]);
      expect(c.figure).toEqual(["20px", "700", "tabular-nums", "-0.2px"]);
      expect(Math.abs(c.width - columns[0]!.width)).toBeLessThanOrEqual(1);
    }
    // « 1 h 04 » stays whole and the sets have no unit: only the volume's « kg » is small.
    expect(columns.map((c) => c.unit)).toEqual([null, null, "12px"]);
    const card = await strip(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, border: s.borderTopWidth };
    });
    if (theme === "light") {
      expect(card.shadow).toContain("0.035");
      expect(card.border).toBe("0px");
    } else {
      expect(card.shadow).toBe("none");
      expect(card.border).toBe("1px");
    }
  });
}

test("with Session volume hidden the strip has two columns", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("belay.sessionVolume", "hidden"));
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, A, "Session A · Push");
  await expect(strip(page).locator("dt")).toHaveText(["Duration", "Sets"]);
  const widths = await strip(page)
    .locator(":scope > div")
    .evaluateAll((divs) => divs.map((d) => d.getBoundingClientRect().width));
  const card = (await strip(page).boundingBox())!;
  expect(widths).toHaveLength(2);
  // Two halves of the card.
  for (const w of widths) expect(Math.abs(w - card.width / 2)).toBeLessThanOrEqual(1);
});

test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  test("the day and start time fit on one line at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open(page, C, "Séance C · Fessiers + tirage léger");
    const line = page.getByText("Mardi 6 octobre · 18 h 00", { exact: true });
    await expect(line).toBeVisible();
    const lines = await line.evaluate((p) => {
      const range = document.createRange();
      range.selectNodeContents(p);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(lines).toBe(1);
  });
});
