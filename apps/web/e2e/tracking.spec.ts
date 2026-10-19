import type { Change } from "@belay/shared/sync/schema";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { ADA, fakeServer, WEEKS } from "./fake-server";

// Wednesday 7 October 2026, 8 a.m. in Paris; timers still run, only the date is fixed.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T08:00:00+02:00"));
});

const hello = (page: Page) => page.getByRole("heading", { name: "Hello, Ada", level: 1 });
const card = (page: Page) => page.getByRole("region", { name: "Today" });
const weighInLine = (page: Page) => page.getByRole("button", { name: /^Weigh-in/ });

test("a weigh-in from Home takes less than 5 seconds: its line, then Save", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await expect(weighInLine(page)).toContainText("not entered yet");
  const start = Date.now(); // from the screen the person sees
  await weighInLine(page).click();
  await expect(page.getByRole("textbox", { name: "Weight" })).toHaveValue("79.9"); // prefilled
  await page.getByRole("button", { name: "Save" }).click();
  await expect(weighInLine(page)).toContainText("79.9 kg");
  expect(Date.now() - start).toBeLessThan(5000);
});

test("airplane mode: the weigh-in stays on the phone and goes once, when the network is back", async ({
  page,
  context,
}) => {
  const server = await fakeServer(page);
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(hello(page)).toBeVisible();

  server.offline = true;
  await context.setOffline(true);
  await weighInLine(page).click();
  await page.getByRole("textbox", { name: "Weight" }).fill("79.8");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(weighInLine(page)).toContainText("79.8 kg");

  await page.reload(); // still offline: the shell and the weigh-in come from the phone
  await expect(hello(page)).toBeVisible();
  await expect(card(page)).toContainText("79.8");
  await expect(
    page.getByText(/1 weigh-in waiting, sent as soon as the network is back/),
  ).toBeVisible();

  server.offline = false;
  await context.setOffline(false);
  const sent = () => server.requests.filter((r) => r.changes.length > 0);
  await expect.poll(() => sent().length).toBe(1);
  await expect(page.getByText(/weigh-in waiting/)).toBeHidden();
  const before = server.requests.length;
  await page.reload(); // the queue is empty: the next sync sends nothing again
  await expect(card(page)).toContainText("79.8");
  await expect.poll(() => server.requests.length).toBeGreaterThan(before);
  expect(sent()).toHaveLength(1);
  expect(sent()[0]).toMatchObject({
    account: ADA.id,
    changes: [{ kind: "weight", date: "2026-10-07", weightKg: 79.8 }],
  });
  expect(server.rows.get("2026-10-07")?.weightKg).toBe(79.8);
});

test("an expired session keeps the entry, and signing in again sends it", async ({ page }) => {
  const server = await fakeServer(page);
  await page.goto("/");
  await expect(hello(page)).toBeVisible();
  server.session = "expired";
  await weighInLine(page).click();
  await page.getByRole("textbox", { name: "Weight" }).fill("80.4");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Your session has expired.")).toBeVisible();
  await expect(page.getByText(/1 weigh-in is waiting to be sent/)).toBeVisible();

  // The identity provider round trip, simulated: the session is live again, back to the app.
  await page.route("**/auth/login**", (route) => {
    server.session = "live";
    return route.fulfill({ status: 302, headers: { location: "/" } });
  });
  await page.getByRole("link", { name: "Sign in again" }).click();
  await expect(hello(page)).toBeVisible();
  await expect.poll(() => server.rows.get("2026-10-07")?.weightKg).toBe(80.4);
  await expect(page.getByText(/waiting to be sent/)).toBeHidden();
});

test("Body lists the weeks, says which ones do not count, and reads the chart from the keyboard", async ({
  page,
}) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/body");
  const weeks = page.getByRole("region", { name: "Your weeks" });
  const rows = weeks.getByRole("listitem");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toHaveText("This weekongoing2 weigh-ins");
  await expect(rows.nth(1)).toHaveText("Sep 28 – Oct 40.7% in your range80.2\u00a0kg");
  await expect(rows.nth(1).locator("svg.lucide-check")).toHaveCount(1); // the pill's check
  await expect(rows.nth(2)).toHaveText("Sep 21 – 27—week before insufficient ·80.8\u00a0kg");
  await expect(rows.nth(3)).toHaveText("Sep 14 – 20—3 weigh-ins, 4 minimum");

  await page.getByRole("img", { name: /^Weigh-ins from Sep 8 to Oct 7\./ }).focus();
  const tooltip = page.locator("[aria-live=polite]");
  await expect(tooltip).toContainText("Tue, Oct 6Weigh-in 79.9");
  await page.keyboard.press("ArrowLeft");
  await expect(tooltip).toContainText("Mon, Oct 5Weigh-in 80.0");
  await page.keyboard.press("Enter");
  const sheet = page.getByRole("dialog", { name: "Weigh-in" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Mon, Oct 5")).toBeVisible(); // the day, in the header
});

// The colour a custom property resolves to, read the way the page paints it.
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${t})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);
// The week's three parts of a row: its title, its value at the right, its parts below.
const weekRows = async (page: Page, changes: Change[] = []) => {
  await fakeServer(page, { rows: WEEKS, changes });
  await page.goto("/body");
  await expect(page.locator(".launch")).toBeHidden();
  const rows = page
    .getByRole("region", { name: /^(Your weeks|Tes semaines)$/ })
    .getByRole("listitem");
  await expect(rows).toHaveCount(4);
  return rows;
};
const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
// A waist and an intake on every weighed day, and a course of creatine: every part is written.
const crowded: Change[] = [
  ...WEEKS.flatMap(({ date }, i): Change[] => [
    { kind: "measure", date, field: "waist", value: 83 - i * 0.1, at: AT },
    { kind: "intake", date, field: "kcal", value: 1850 + i * 10, at: AT },
  ]),
  { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
  { kind: "supplementLog", supplementId: CREATINE, date: "2026-09-30", taken: true, at: AT },
];

test("the weeks are one grouped list of 56 px rows: the value 15 px 600 tabular at the right, the parts 13 px muted", async ({
  page,
}) => {
  const rows = await weekRows(page, crowded);
  const list = page.getByRole("region", { name: "Your weeks" }).getByRole("list");
  await expect(list).toHaveCount(1);
  await expect(list).toHaveCSS("border-radius", "16px");
  const muted = await tokenColor(page, "--muted-foreground");
  for (const row of await rows.all()) {
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(56);
    const value = row.locator(":scope > :nth-child(2)");
    await expect(value).toHaveCSS("font-size", "15px");
    await expect(value).toHaveCSS("font-weight", "600");
    await expect(value).toHaveCSS("font-variant-numeric", "tabular-nums");
    const v = (await value.boundingBox())!;
    expect(Math.abs(v.x + v.width - (box.x + box.width - 16))).toBeLessThanOrEqual(1);
    const parts = row.locator(":scope > :nth-child(3)");
    await expect(parts).toHaveCSS("font-size", "13px");
    await expect(parts).toHaveCSS("color", muted);
    await expect(parts).toHaveCSS("font-variant-numeric", "tabular-nums");
    // The parts sit on the second line, under the title.
    const title = (await row.locator(":scope > :nth-child(1)").boundingBox())!;
    expect((await parts.boundingBox())!.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  }
  await expect(rows.nth(1).locator(":scope > :nth-child(3)")).toHaveText(
    "80.2\u00a0kg ·waist 82 cm ·1,935 kcal ·creatine",
  );
});

test("the in-range pill is reference green with its check", async ({ page }) => {
  const rows = await weekRows(page);
  const pill = rows.nth(1).locator(":scope > :nth-child(2) > span");
  await expect(pill).toHaveCSS("background-color", await tokenColor(page, "--reference"));
  await expect(pill).toHaveCSS("color", await tokenColor(page, "--reference-ink"));
  await expect(pill).toHaveCSS("font-size", "12px");
  await expect(pill).toHaveCSS("font-weight", "600");
  const check = pill.locator("svg.lucide-check");
  await expect(check).toHaveAttribute("aria-hidden", "true");
  expect((await check.boundingBox())!.width).toBe(12);
  // Said once in the header too, after the same check.
  const header = page.getByRole("heading", { name: "Your weeks" }).locator("xpath=..");
  await expect(header).toHaveText("Your weeksin your range");
  await expect(header.locator("svg.lucide-check")).toHaveCount(1);
});

test.describe("in French at 360 px", () => {
  test.use({ locale: "fr-FR", viewport: { width: 360, height: 780 } });
  test("the weeks wrap only between parts and nothing scrolls sideways", async ({ page }) => {
    const rows = await weekRows(page, crowded);
    await expect(rows.nth(1)).toContainText("taille");
    for (const row of await rows.all()) {
      const parts = row.locator(":scope > :nth-child(3) > span");
      for (const part of await parts.all()) {
        // One line each: a part breaks onto the next line whole, never inside itself.
        expect(await part.evaluate((e) => e.getClientRects().length)).toBe(1);
        const lineHeight = await part.evaluate((e) => parseFloat(getComputedStyle(e).lineHeight));
        expect((await part.boundingBox())!.height).toBeLessThanOrEqual(lineHeight + 1);
      }
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test("Profile: the range steppers stop at 1 % and keep 0.1 between the bounds", async ({
  page,
}) => {
  await fakeServer(page);
  await page.goto("/settings/profile");
  const atLeast = page.getByRole("textbox", { name: "At least" });
  await expect(atLeast).toHaveValue("0.5");
  await expect(page.getByRole("button", { name: "Increase At most" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  for (const next of ["0.55", "0.6", "0.65", "0.7", "0.75", "0.8", "0.85", "0.9"]) {
    await page.getByRole("button", { name: "Increase At least" }).click();
    await expect(atLeast).toHaveValue(next);
  }
  await expect(page.getByRole("button", { name: "Increase At least" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("Profile cards follow the kit", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeServer(page);
  await page.goto("/settings/profile");
  const labels = page.locator("main h2");
  await expect(labels).toHaveCount(2);
  for (const label of await labels.all()) {
    await expect(label).toHaveCSS("font-size", "13px");
    await expect(label).toHaveCSS("text-transform", "none");
    // The card sits right under its label, with the kit's 16 px corners.
    await expect(label.locator("xpath=following-sibling::*[1]")).toHaveCSS("border-radius", "16px");
  }
  const fills = page.getByRole("button", { name: /^Fill in / });
  await expect(fills).toHaveCount(3);
  for (const fill of await fills.all()) {
    const box = (await fill.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    // As wide as the card's content: the card less its 16 px side padding.
    const card = (await fill
      .locator("xpath=ancestor::div[contains(@class,'rounded-group')]")
      .boundingBox())!;
    expect(Math.abs(box.width - (card.width - 32))).toBeLessThanOrEqual(1);
  }
  const destructive = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--destructive)";
    document.body.append(probe);
    const red = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll<HTMLElement>("main *")]
      .filter((el) => {
        const s = getComputedStyle(el);
        return s.color === red || s.backgroundColor === red || s.borderTopColor === red;
      })
      .map((el) => el.tagName);
  });
  expect(destructive).toEqual([]);
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour (Save fades in once the field is filled).
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`signed-in screens have no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      const server = await fakeServer(page, {
        rows: [...WEEKS, { date: "2026-10-07", weightKg: 79.8 }],
      });

      await page.goto("/"); // weighed in today: the card says so, the trend is there
      await expect(page.getByRole("region", { name: "Your trend" })).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);

      await weighInLine(page).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectNoAxeViolations(page);
      await page.keyboard.press("Escape");

      await page.goto("/body");
      await expect(page.getByRole("region", { name: "Your weeks" })).toBeVisible();
      await page.getByRole("img", { name: /^Weigh-ins from/ }).focus();
      await expectNoAxeViolations(page);

      await page.goto("/settings/profile");
      await page.locator("details").evaluateAll((all) => {
        for (const d of all) (d as HTMLDetailsElement).open = true;
      });
      await expectNoAxeViolations(page);

      server.session = "expired"; // the banner that asks to sign in again
      await page.goto("/");
      await weighInLine(page).click();
      // The sheet's own Save: a click in the frame the lazy sheet mounts can land nowhere.
      await page
        .getByRole("dialog", { name: "Weigh-in" })
        .getByRole("button", { name: "Save" })
        .click();
      await expect(page.getByText("Your session has expired.")).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the first days and the empty card have no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page, { rows: [{ date: "2026-10-06", weightKg: 80.2 }] });
      await page.goto("/");
      await expect(weighInLine(page)).toContainText("not entered yet");
      await expectNoAxeViolations(page);
      await weighInLine(page).click();
      await expect(page.getByRole("textbox", { name: "Weight" })).toHaveValue("80.2");
      await expectNoAxeViolations(page);
      await page.goto("/body");
      await expect(page.getByRole("heading", { name: "3 more weigh-ins this week" })).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }
});
