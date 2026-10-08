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
  await expect(weighInLine(page)).toContainText("79.9 kg · saved");
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
  await expect(weighInLine(page)).toContainText("79.8 kg · saved");

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
  await expect(weeks.getByRole("listitem")).toHaveCount(4);
  await expect(weeks.getByRole("listitem").nth(1)).toContainText("0.7%in your range");
  await expect(weeks).toContainText("week before insufficient");
  await expect(weeks).toContainText("3 weigh-ins, 4 minimum");

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
