import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// Séances' history: the month's calendar in one card, days as 40 px discs.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${String(n).padStart(12, "0")}`;
// A finished session on a day in Paris, as another device sent it.
function finished(n: number, day: string, code = "A"): Change[] {
  const startedAt = new Date(`${day}T08:00:00+02:00`).toISOString();
  const endedAt = new Date(`${day}T09:00:00+02:00`).toISOString();
  return [
    {
      kind: "workout",
      id: id(n),
      field: "start",
      sessionCode: code,
      plan: [...sessionByCode(code, starterProgram)!.slots],
      startedAt,
      at: startedAt,
    },
    { kind: "workout", id: id(n), field: "ended", value: endedAt, at: endedAt },
  ];
}
const climb = (day: string): Change => ({
  kind: "activity",
  id: id(90),
  field: "fields",
  date: day,
  type: "climbing",
  durationMin: 90,
  cardioType: null,
  climbStyle: "boulder",
  climbRuns: 14,
  climbGrade: "6b+",
  climbColor: null,
  at: `${day}T16:00:00.000Z`,
});
// Sessions on the 2nd and the 7th of the month, an activity on the 3rd.
const month = (ym: string): Change[] => [
  ...finished(1, `${ym}-02`),
  ...finished(2, `${ym}-07`),
  climb(`${ym}-03`),
];

async function openHistory(page: Page, changes: Change[]) {
  await fakeServer(page, { changes });
  await page.goto("/workouts?tab=history");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.locator('[data-day$="-02"]')).toHaveClass(/bg-primary/);
}
const calendarCard = (page: Page) => page.getByRole("table").locator("..");

test.describe("on Wednesday 7 October 2026", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the calendar, its arrows and its legend sit in one card on the kit's surface, ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await openHistory(page, month("2026-10"));
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      const card = calendarCard(page);
      const box = (await card.boundingBox())!;
      const inside = async (l: ReturnType<Page["locator"]>) => {
        const b = (await l.boundingBox())!;
        expect(b.x).toBeGreaterThanOrEqual(box.x);
        expect(b.y).toBeGreaterThanOrEqual(box.y);
        expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
        expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
      };
      await inside(page.getByRole("table"));
      await inside(page.getByRole("button", { name: "Previous month" }));
      await inside(page.getByRole("button", { name: "Next month" }));
      await inside(page.getByRole("list", { name: "Legend" }));
      const style = await card.evaluate((el) => {
        const s = getComputedStyle(el);
        return { shadow: s.boxShadow, border: s.borderTopWidth, radius: s.borderTopLeftRadius };
      });
      expect(style.radius).toBe("18px");
      if (theme === "light") {
        expect(style.shadow).toContain("0.035");
        expect(style.border).toBe("0px");
      } else {
        expect(style.shadow).toBe("none");
        expect(style.border).toBe("1px");
      }
    });
  }

  test("days are 40 px discs and the month arrows at least 44 px", async ({ page }) => {
    await openHistory(page, month("2026-10"));
    const days = page.locator("[data-day]");
    expect(await days.count()).toBe(31);
    for (const b of await days.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect),
    )) {
      expect([b.width, b.height]).toEqual([40, 40]);
    }
    for (const name of ["Previous month", "Next month"]) {
      const b = (await page.getByRole("button", { name }).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });

  for (const width of [360, 390, 1280]) {
    test(`today on a session day keeps its ring clear of its neighbours at ${width} px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await openHistory(page, month("2026-10"));
      const reach = await page.locator('[data-day="2026-10-07"]').evaluate((el) => {
        const s = getComputedStyle(el);
        const out = parseFloat(s.outlineWidth) + parseFloat(s.outlineOffset);
        const b = el.getBoundingClientRect();
        return { l: b.left - out, r: b.right + out, t: b.top - out, b: b.bottom + out, out };
      });
      expect(reach.out).toBeGreaterThan(0);
      // Tuesday the 6th and Thursday the 8th beside, Wednesday 30 Sept is blank: the 14th below.
      for (const n of ["06", "08", "14"]) {
        const b = (await page.locator(`[data-day="2026-10-${n}"]`).boundingBox())!;
        const meets =
          b.x < reach.r && b.x + b.width > reach.l && b.y < reach.b && b.y + b.height > reach.t;
        expect(meets, `the ring meets the ${n}`).toBe(false);
      }
    });
  }

  test("Back from a session of September opens September again", async ({ page }) => {
    await openHistory(page, [...month("2026-10"), ...finished(5, "2026-09-15", "B")]);
    await page.getByRole("button", { name: "Previous month" }).click();
    await expect(page.getByRole("table", { name: "September 2026" })).toBeVisible();
    await page.getByRole("region", { name: "September 2026" }).getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1, name: /^Session B/ })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("table", { name: "September 2026" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: "September 2026" }).getByRole("link"),
    ).toHaveCount(1);
  });

  for (const width of [360, 1280]) {
    test(`History has nothing scrolling sideways at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openHistory(page, month("2026-10"));
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(over).toBeLessThanOrEqual(0);
    });
  }
});

// On the real clock: a month that slid in would show in the animation list.
test("a tapped month arrow shows the other month in the next frame, with no animation", async ({
  page,
}) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const ym = today.slice(0, 7);
  await openHistory(page, month(ym));
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const previous = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 2, 1)));
  const seen = await page.evaluate(async () => {
    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Previous month"]',
    )!;
    button.click();
    await new Promise((r) => requestAnimationFrame(r));
    const table = document.querySelector("table")!;
    const card = table.parentElement!;
    return {
      caption: table.caption?.textContent ?? "",
      animations: document.getAnimations().filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        return target instanceof Node && card.contains(target);
      }).length,
    };
  });
  expect(seen.caption.toLowerCase()).toBe(previous.toLowerCase());
  expect(seen.animations).toBe(0);
});

// A token's colour as the browser computes it, to compare with an element's.
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);
const box = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!;

test.describe("the history's rows, on Wednesday 7 October 2026", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
  });

  test("the log row sits under the calendar: 56 px, a 28 px icon square, a 16 px chevron, no orange text", async ({
    page,
  }) => {
    await openHistory(page, month("2026-10"));
    const row = page.getByRole("button", { name: /^Log a session/ });
    await expect(row).toHaveText(/Log a session\s*done without the app, on another day/);
    const card = await box(calendarCard(page));
    const b = await box(row);
    expect(b.y).toBeGreaterThanOrEqual(card.y + card.height);
    expect(b.height).toBe(56);
    const icon = await box(row.locator('[data-slot="row-icon"]'));
    expect([icon.width, icon.height]).toEqual([28, 28]);
    const chevron = await box(row.locator('[data-slot="row-chevron"]'));
    expect([chevron.width, chevron.height]).toEqual([16, 16]);
    const label = row.getByText("Log a session", { exact: true });
    expect(await label.evaluate((el) => getComputedStyle(el).color)).toBe(
      await tokenColor(page, "--foreground"),
    );
    // The orange button above the calendar is gone.
    await expect(page.getByRole("button", { name: /Log a session/ })).toHaveCount(1);
  });

  test("sessions and activities read as one grouped list of 56 px rows with 28 px icon squares", async ({
    page,
  }) => {
    await openHistory(page, month("2026-10"));
    const recent = page.getByRole("region", { name: "Recent" });
    const list = recent.getByRole("list");
    await expect(list).toHaveCount(1);
    const items = list.getByRole("listitem");
    await expect(items).toHaveCount(3);
    const borderColor = tokenColor(page, "--border");
    await expect(items.nth(0)).toHaveText(/Wed, Oct 7 · 1 h 00\s*Session A · Push/);
    await expect(items.nth(1)).toHaveText(/Sat, Oct 3\s*Climbing · 1 h 30 · 6b\+/);
    const surface = await list.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(surface).toBe(await tokenColor(page, "--surface"));
    expect(await list.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe("0px");
    for (let i = 0; i < 3; i++) {
      const row = items.nth(i).locator("a, button");
      expect((await box(row)).height).toBe(56);
      const icon = await box(row.locator('[data-slot="row-icon"]'));
      expect([icon.width, icon.height]).toEqual([28, 28]);
      // A hairline in the border colour between rows, none under the last.
      const line = await items.nth(i).evaluate((el) => {
        const st = getComputedStyle(el);
        return { width: st.borderBottomWidth, color: st.borderBottomColor };
      });
      expect(line.width).toBe(i === 2 ? "0px" : "1px");
      if (i < 2) expect(line.color).toBe(await borderColor);
    }
  });

  test("the « Recent » header is the shared section label: 13 px, 600, muted", async ({ page }) => {
    await openHistory(page, month("2026-10"));
    const header = page.getByRole("heading", { name: "Recent", level: 2 });
    const style = await header.evaluate((el) => {
      const s = getComputedStyle(el);
      return { size: s.fontSize, weight: s.fontWeight, color: s.color };
    });
    expect(style).toEqual({
      size: "13px",
      weight: "600",
      color: await tokenColor(page, "--muted-foreground"),
    });
  });

  test.describe("in French", () => {
    test.use({ locale: "fr-FR" });

    test("the longest session title shows whole at 360 px in French", async ({ page }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await openHistory(page, [...month("2026-10"), ...finished(3, "2026-10-06", "C")]);
      const row = page.getByRole("region", { name: "Récentes" }).getByRole("link", {
        name: /^Mar\. 6 oct\./,
      });
      const title = row.getByText("Séance C · Fessiers + tirage léger", { exact: true });
      await expect(title).toBeVisible();
      const fit = await title.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(fit).toBeLessThanOrEqual(0);
    });
  });

  for (const theme of ["light", "dark"] as const) {
    test(`History, empty, has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page, { changes: [] });
      await page.goto("/workouts?tab=history");
      const sentence = page.getByText("Your first session will show here.");
      await expect(sentence).toBeVisible();
      // The empty state stands on the kit's group surface: its card is the sentence's grandparent.
      const card = sentence.locator("xpath=../..");
      expect(await card.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        await page.evaluate(() => {
          const probe = document.createElement("div");
          probe.style.backgroundColor = "var(--surface)";
          document.body.append(probe);
          const value = getComputedStyle(probe).backgroundColor;
          probe.remove();
          return value;
        }),
      );
      await expect(
        page.getByText(
          "It shows up on its own when you finish a session, or with “Log a session”.",
        ),
      ).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test.describe("in French", () => {
    test.use({ locale: "fr-FR" });

    test("the empty History reads a regular sentence over a smaller muted line, two lines at 360 px", async ({
      page,
    }) => {
      await page.setViewportSize({ width: 360, height: 800 });
      await fakeServer(page, { changes: [] });
      await page.goto("/workouts?tab=history");
      const sentence = page.getByText("Ta première séance apparaîtra ici.");
      await expect(sentence).toBeVisible();
      const how = sentence.locator("xpath=following-sibling::p[1]");
      const read = (l: typeof sentence) =>
        l.evaluate((el) => {
          const s = getComputedStyle(el);
          return {
            size: s.fontSize,
            weight: s.fontWeight,
            color: s.color,
            lines: Math.round(el.getBoundingClientRect().height / parseFloat(s.lineHeight)),
          };
        });
      const first = await read(sentence);
      expect([first.size, first.weight]).toEqual(["15px", "400"]);
      const second = await read(how);
      expect(second).toEqual({
        size: "13px",
        weight: "400",
        color: await tokenColor(page, "--muted-foreground"),
        lines: 2,
      });
    });
  });

  test("an empty History has nothing scrolling sideways at 360 px", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await fakeServer(page, { changes: [] });
    await page.goto("/workouts?tab=history");
    await expect(page.locator(".launch")).toBeHidden();
    await expect(page.getByText("Your first session will show here.")).toBeVisible();
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
  });
});

test.describe("with Sessions only, on Wednesday 7 October 2026", () => {
  test.beforeEach(async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
  });

  test("Sessions only keeps the history to gym sessions, Home keeps its Activity row", async ({
    page,
  }) => {
    await fakeServer(page, { changes: month("2026-10") });
    await page.goto("/");
    await expect(page.locator(".launch")).toBeHidden();
    await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    const trigger = page.getByRole("combobox", { name: /^History · / });
    await trigger.click();
    await page.getByRole("option", { name: "Sessions only" }).click();
    await expect(trigger).toHaveAccessibleName("History · Sessions only");
    await page.goBack();
    await expect(page.getByRole("button", { name: /^Activity/ })).toBeVisible();
    await page.getByRole("link", { name: "Sessions" }).click();
    await page.getByRole("radio", { name: "History" }).click();
    await expect(page.locator('[data-day$="-02"]')).toHaveClass(/bg-primary/);
    await expect(page.getByRole("region", { name: "Recent" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.locator("[data-dot]")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Legend" }).getByRole("listitem")).toHaveCount(2);
  });
});
