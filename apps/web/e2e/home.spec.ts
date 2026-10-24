import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock: Accueil's date is today's, as Paris has it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// Session A started ten minutes ago, still open.
const RUNNING = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const runningA = (): Change[] => {
  const at = new Date(Date.now() - 10 * 60_000).toISOString();
  return [
    {
      kind: "workout",
      id: RUNNING,
      field: "start",
      sessionCode: "A",
      plan: [...sessionByCode("A")!.slots],
      startedAt: at,
      at,
    },
  ];
};

const sessionCard = (page: Page) => page.getByRole("region", { name: /^Session A · Push/ });

async function openHome(
  page: Page,
  changes: Change[] = [],
  rows: { date: string; weightKg: number }[] = [],
) {
  await fakeServer(page, { changes, rows });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(sessionCard(page)).toBeVisible();
}

test("Accueil opens on today's date above the greeting", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  await openHome(page);
  const date = page.getByText(today, { exact: true });
  const h1 = page.getByRole("heading", { level: 1, name: "Hello, Ada" });
  await expect(date).toBeVisible();
  const [dateBox, titleBox] = [(await date.boundingBox())!, (await h1.boundingBox())!];
  expect(dateBox.y + dateBox.height).toBeLessThanOrEqual(titleBox.y + 1);
  const style = await date.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, weight: s.fontWeight, color: s.color };
  });
  // Muted, in the colour of the card's own muted line.
  const muted = await sessionCard(page)
    .getByText(/exercises · about/)
    .evaluate((el) => getComputedStyle(el).color);
  expect(style).toEqual({ size: "13px", weight: "500", color: muted });
});

// Accueil's rhythm: 16 px from the header (greeting and avatar) to the session card.
for (const width of [360, 390, 1280]) {
  test(`the session card sits 16 px under the header at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openHome(page);
    const header = page.getByRole("heading", { level: 1, name: "Hello, Ada" }).locator("../..");
    const [headerBox, cardBox] = [
      (await header.boundingBox())!,
      (await sessionCard(page).boundingBox())!,
    ];
    expect(cardBox.y - (headerBox.y + headerBox.height)).toBeCloseTo(16, 0);
  });
}

test("the next session's card pushes its preview", async ({ page }) => {
  await openHome(page);
  const card = sessionCard(page);
  await expect(card).toContainText("Next up · 6 exercises · about 55 min");
  await card.getByRole("link", { name: "See the session" }).click();
  await expect(page).toHaveURL(/\/workouts\/session\/A\?from=home$/);
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }),
  ).toHaveAttribute("aria-current", "page");
});

test("with a session open the card resumes it", async ({ page }) => {
  await openHome(page, runningA());
  const card = sessionCard(page);
  await expect(card).toContainText("In progress · 0 of 19 sets");
  await card.getByRole("link", { name: "Resume" }).click();
  await expect(page).toHaveURL(/\/workout$/);
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeVisible();
});

test("the session card sits on the kit's surface: a ring in light, a border in dark", async ({
  page,
}) => {
  const surface = () =>
    sessionCard(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, border: s.borderTopWidth, radius: s.borderTopLeftRadius };
    });
  await page.addInitScript(() => localStorage.setItem("belay.theme", "light"));
  await openHome(page);
  const light = await surface();
  expect(light.shadow).toContain("rgba(28, 25, 23, 0.035) 0px 0px 0px 1px");
  expect(light.border).toBe("0px");
  expect(light.radius).toBe("18px");
  await page.addInitScript(() => localStorage.setItem("belay.theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(sessionCard(page)).toBeVisible();
  expect(await surface()).toEqual({ shadow: "none", border: "1px", radius: "18px" });
});

for (const theme of ["light", "dark"] as const) {
  test(`Accueil with the next session has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await openHome(page);
    await expectNoAxeViolations(page);
  });

  test(`Accueil with a session open has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await openHome(page, runningA());
    await expect(sessionCard(page)).toContainText("In progress");
    await expectNoAxeViolations(page);
  });
}

// Every rule, best practices included: the session bar sits in a landmark like the rest.
test("Accueil with the session bar up leaves nothing outside a landmark", async ({ page }) => {
  await openHome(page, runningA());
  await expect(page.getByRole("region", { name: "Session in progress" })).toBeVisible();
  await settled(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
});

// Session A started half a minute ago and ended a second ago: done today, B comes next.
const DONE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f02";
// A fixed Paris noon, so the session never starts before today's midnight whatever the second
// the test runs at; timers still run, only the date is fixed.
const DONE_NOW = new Date("2026-10-07T12:00:00+02:00");
const doneA = (now = DONE_NOW): Change[] => {
  const from = new Date(now.getTime() - 30_000).toISOString();
  const to = new Date(now.getTime() - 15_000).toISOString();
  return [
    {
      kind: "workout",
      id: DONE,
      field: "start",
      sessionCode: "A",
      plan: [...sessionByCode("A")!.slots],
      startedAt: from,
      at: from,
    },
    { kind: "workout", id: DONE, field: "ended", value: to, at: to },
  ];
};
const fixDate = (page: Page) => page.clock.setFixedTime(DONE_NOW);

test.describe("the session done", () => {
  test("after today's session the card says done and names the next one quietly", async ({
    page,
  }) => {
    await fixDate(page);
    await openHome(page, doneA());
    const card = sessionCard(page);
    await expect(card).toContainText("Done today · ");
    // No filled button and no accent anywhere in the card.
    const accent = await card.evaluate((el) => {
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--primary)";
      document.body.append(probe);
      const primary = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return [el, ...el.querySelectorAll("*")].filter(
        (n) => getComputedStyle(n).backgroundColor === primary,
      ).length;
    });
    expect(accent).toBe(0);
    const next = card.getByRole("link", { name: "Next up: Session B · Legs" });
    await expect(next).toHaveAttribute("href", "/workouts/session/B?from=home");
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(48);
  });

  for (const theme of ["light", "dark"] as const)
    test(`Accueil with the session done has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fixDate(page);
      await openHome(page, doneA());
      await expect(sessionCard(page)).toContainText("Done today");
      await expectNoAxeViolations(page);
    });
});

// Accueil's kit values, read from the page and not from class names.
const px = (el: Locator, prop: string) =>
  el.evaluate((node, p) => getComputedStyle(node).getPropertyValue(p), prop);
const colour = (page: Page, name: string, prop = "color") =>
  page.evaluate(
    ([n, p]) => {
      const probe = document.createElement("span");
      probe.style.setProperty(p!, `var(${n})`);
      document.body.append(probe);
      const value = getComputedStyle(probe).getPropertyValue(p!);
      probe.remove();
      return value;
    },
    [name, prop],
  );

test("the session card's title is 17 px 600 and its lead is in the accent ink", async ({
  page,
}) => {
  await openHome(page);
  const title = sessionCard(page).getByRole("heading", { name: /^Session A · Push/ });
  expect(await px(title, "font-size")).toBe("17px");
  expect(await px(title, "font-weight")).toBe("600");
  const lead = sessionCard(page).getByText("Next up · ", { exact: true });
  expect(await px(lead, "color")).toBe(await colour(page, "--primary-ink"));
  expect(await px(lead, "font-weight")).toBe("600");
});

test("the done tile is 36 px and tinted in the reference green", async ({ page }) => {
  await fixDate(page);
  await openHome(page, doneA());
  const tile = sessionCard(page).locator("svg").first().locator("..");
  const box = (await tile.boundingBox())!;
  expect([box.width, box.height]).toEqual([36, 36]);
  expect(await px(tile, "background-color")).toBe(
    await colour(page, "--reference", "background-color"),
  );
  expect(await px(tile, "color")).toBe(await colour(page, "--reference-ink"));
});

test("the Today header is a 13 px 600 label, and comes before the trend", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  await openHome(page, [], [{ date: today, weightKg: 80.4 }]);
  const header = page.getByRole("heading", { name: "Today", level: 2 });
  const trend = page.getByRole("heading", { name: "Your trend", level: 2 });
  await expect(trend).toBeVisible();
  expect(await px(header, "font-size")).toBe("13px");
  expect(await px(header, "font-weight")).toBe("600");
  const before = await header.evaluate(
    (a, b) => !!(a.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING),
    await trend.elementHandle(),
  );
  expect(before).toBe(true);
});
