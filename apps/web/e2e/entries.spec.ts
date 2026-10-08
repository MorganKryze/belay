import type { Change } from "@belay/shared/sync/schema";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { ADA, fakeServer, WEEKS } from "./fake-server";

// Wednesday 7 October 2026, 8 a.m. in Paris; timers still run, only the date is fixed.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T08:00:00+02:00"));
});

const AT = "2026-10-01T06:30:00.000Z";
const CREATINE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8f";
const VITAMIN = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d90";
const NOTE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d91";
// Entries another device already sent: a profile, two supplements, a waist, a diet break.
const ON_SERVER: Change[] = [
  { kind: "profile", field: "formula", value: "male", at: AT },
  { kind: "profile", field: "birthYear", value: 1995, at: AT },
  { kind: "profile", field: "height", value: 178, at: AT },
  { kind: "supplement", id: CREATINE, field: "name", value: "Créatine", at: AT },
  { kind: "supplement", id: VITAMIN, field: "name", value: "Vitamine D", at: AT },
  { kind: "measure", date: "2026-10-06", field: "waist", value: 82, at: AT },
  { kind: "measure", date: "2026-10-06", field: "neck", value: 39, at: AT },
  {
    kind: "annotation",
    id: NOTE,
    field: "fields",
    date: "2026-09-22",
    type: "diet_break",
    label: null,
    at: AT,
  },
];
const line = (page: Page, name: RegExp) => page.getByRole("button", { name });
const sheet = (page: Page, name: string) => page.getByRole("dialog", { name });

test("intake and a supplement entered offline go once, when the network is back", async ({
  page,
  context,
}) => {
  const server = await fakeServer(page, { rows: WEEKS, changes: ON_SERVER });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await expect(line(page, /^Supplements/)).toContainText("0 of 2");

  server.offline = true;
  await context.setOffline(true);
  await line(page, /^Intake/).click();
  await sheet(page, "Intake").getByRole("textbox", { name: "Calories" }).fill("2100");
  await sheet(page, "Intake").getByRole("button", { name: "Save" }).click();
  await expect(line(page, /^Intake/)).toContainText("2,100 kcal");
  await line(page, /^Supplements/).click();
  await sheet(page, "Supplements").getByRole("checkbox", { name: "Vitamine D" }).check();
  await page.keyboard.press("Escape");
  await expect(line(page, /^Supplements/)).toContainText("1 of 2");
  await expect(
    page.getByText(/2 entries waiting, sent as soon as the network is back/),
  ).toBeVisible();

  server.offline = false;
  await context.setOffline(false);
  const sent = () => server.requests.filter((r) => r.changes.length > 0);
  await expect.poll(() => sent().length).toBe(1);
  await expect(page.getByText(/entries waiting/)).toBeHidden();
  expect(sent()[0]).toMatchObject({
    account: ADA.id,
    changes: [
      { kind: "intake", date: "2026-10-07", field: "kcal", value: 2100 },
      { kind: "supplementLog", supplementId: VITAMIN, date: "2026-10-07", taken: true },
    ],
  });
});

test("one day of creatine ticked marks its course on Body", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS, changes: ON_SERVER });
  await page.goto("/");
  await line(page, /^Supplements/).click();
  await sheet(page, "Supplements").getByRole("checkbox", { name: "Créatine" }).check();
  await expect(sheet(page, "Supplements").getByText("for 1 day")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Body" }).click();
  await expect(page.getByText("creatine · 14 d")).toBeVisible();
  await expect(page.getByText(/rises by 1 to 2 kg of water/)).toBeVisible();
  const weeks = page.getByRole("region", { name: "Your weeks" });
  await expect(weeks.getByRole("listitem").first()).toContainText("creatine");
});

test("an annotation is added on Body, drawn on its week, then deleted", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/body");
  await page.getByRole("button", { name: "Annotation", exact: true }).click();
  const add = sheet(page, "New annotation");
  await add.getByRole("radio", { name: "Break" }).click();
  await add.getByLabel("Date of the annotation").fill("2026-09-29");
  await add.getByRole("button", { name: "Add" }).click();
  const weeks = page.getByRole("region", { name: "Your weeks" });
  const pill = weeks.getByRole("button", { name: "Open the annotation Break" });
  await expect(pill).toBeVisible();
  await pill.click();
  await sheet(page, "Annotation").getByRole("button", { name: "Delete this annotation" }).click();
  await expect(pill).toBeHidden();
  await expect(page.getByText("Annotation deleted")).toBeVisible();
});

test("the energy tool opens from the profile and the 7-day average", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS, changes: ON_SERVER });
  await page.goto("/"); // the first sync brings the profile to the phone
  await expect(line(page, /^Supplements/)).toContainText("0 of 2");
  await page.goto("/tools/energy");
  await expect(page.getByRole("textbox", { name: "Height" })).toHaveValue("178");
  await expect(page.getByRole("textbox", { name: "Age" })).toHaveValue("31");
  await expect(page.getByRole("radio", { name: "Male", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(page.getByText("from your year of birth")).toBeVisible();
  await expect(page.getByText("your 7-day average")).toBeVisible();
  await page.getByRole("textbox", { name: "Height" }).fill("180");
  await expect(page.getByRole("group", { name: "Profile update" })).toBeVisible();
});

// Every new screen and sheet, signed in, as the person meets them. The accessibility test runs
// them one after the other on one device, so each step waits for data, not for a fresh state.
const SCREENS: [string, (page: Page) => Promise<void>][] = [
  [
    "Home",
    async (page) => {
      await page.goto("/");
      await expect(line(page, /^Supplements/)).toContainText(/of 2$/);
    },
  ],
  [
    "the weigh-in sheet",
    async (page) => {
      await page.goto("/");
      await page.getByRole("button", { name: /^Weigh-in/ }).click();
      await expect(sheet(page, "Weigh-in").getByRole("textbox", { name: "Weight" })).toBeVisible();
    },
  ],
  [
    "the intake sheet",
    async (page) => {
      await page.goto("/");
      await line(page, /^Intake/).click();
      await expect(sheet(page, "Intake").getByRole("textbox", { name: "Calories" })).toBeVisible();
    },
  ],
  [
    "the supplements sheet",
    async (page) => {
      await page.goto("/");
      await line(page, /^Supplements/).click();
      await sheet(page, "Supplements").getByRole("checkbox", { name: "Créatine" }).check();
      await expect(sheet(page, "Supplements").getByText("for 1 day")).toBeVisible();
    },
  ],
  [
    "Body",
    async (page) => {
      await page.goto("/");
      await line(page, /^Supplements/).click();
      await sheet(page, "Supplements").getByRole("checkbox", { name: "Créatine" }).check();
      // The course shows once the tick is written on the phone: then Body can read it.
      await expect(sheet(page, "Supplements").getByText("for 1 day")).toBeVisible();
      await page.goto("/body");
      await expect(page.getByText("creatine · 14 d")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open the annotation Break" })).toBeVisible();
    },
  ],
  [
    "the measurements sheet",
    async (page) => {
      await page.goto("/body");
      await page.getByRole("button", { name: "Measurements" }).click();
      await expect(
        sheet(page, "Measurements").getByRole("textbox", { name: "Waist" }),
      ).toBeVisible();
    },
  ],
  [
    "the annotation sheet",
    async (page) => {
      await page.goto("/body");
      await page.getByRole("button", { name: "Open the annotation Break" }).click();
      await expect(
        sheet(page, "Annotation").getByRole("button", { name: "Delete this annotation" }),
      ).toBeVisible();
    },
  ],
  [
    "Profile",
    async (page) => {
      await page.goto("/");
      await expect(line(page, /^Supplements/)).toContainText(/of 2$/);
      await page.goto("/settings/profile");
      await expect(page.getByRole("button", { name: "Clear Height" })).toBeVisible();
    },
  ],
  [
    "My supplements",
    async (page) => {
      await page.goto("/settings/supplements");
      await page.getByRole("button", { name: "More for Créatine" }).click();
      await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
    },
  ],
  [
    "the prefilled energy tool",
    async (page) => {
      await page.goto("/");
      await expect(line(page, /^Supplements/)).toContainText(/of 2$/);
      await page.goto("/tools/energy");
      await page.getByRole("textbox", { name: "Height" }).fill("180");
      await expect(page.getByRole("group", { name: "Profile update" })).toBeVisible();
    },
  ],
  [
    "the prefilled body-fat tool",
    async (page) => {
      await page.goto("/");
      await expect(line(page, /^Supplements/)).toContainText(/of 2$/);
      await page.goto("/tools/body-fat");
      await expect(page.getByText(/^measured on/).first()).toBeVisible();
    },
  ],
];

// Nothing entered yet: the same screens with their empty states, on a server with no data.
const EMPTY_SCREENS: [string, (page: Page) => Promise<void>][] = [
  [
    "empty Home",
    async (page) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Hello, Ada", level: 1 })).toBeVisible();
      await expect(line(page, /^Intake/)).toBeVisible();
    },
  ],
  [
    "empty Profile",
    async (page) => {
      await page.goto("/settings/profile");
      await expect(page.getByRole("button", { name: "Fill in Height" })).toBeVisible();
    },
  ],
];

// A sheet is a fixed dialog: the page can fit while the dialog itself scrolls sideways or sits
// partly off screen, so the dialog is measured too.
async function expectFits(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  const dialog = page.getByRole("dialog");
  if ((await dialog.count()) === 0) return;
  const { inside, sideways } = await dialog.first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    return {
      sideways: el.scrollWidth - el.clientWidth,
      inside:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight,
    };
  });
  expect(sideways).toBeLessThanOrEqual(0);
  expect(inside).toBe(true);
}

test.describe("at 360 px", () => {
  test.use({ viewport: { width: 360, height: 780 } });
  for (const [name, open] of SCREENS) {
    test(`${name} fits without sideways scrolling`, async ({ page }) => {
      await fakeServer(page, { rows: WEEKS, changes: ON_SERVER });
      await open(page);
      await expectFits(page);
    });
  }
  for (const [name, open] of EMPTY_SCREENS) {
    test(`${name} fits without sideways scrolling`, async ({ page }) => {
      await fakeServer(page);
      await open(page);
      await expectFits(page);
    });
  }
});

test.describe("accessibility", () => {
  // No transition in flight when axe measures a colour.
  test.use({ reducedMotion: "reduce" });
  for (const theme of ["light", "dark"] as const) {
    test(`the new screens and sheets have no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page, { rows: WEEKS, changes: ON_SERVER });
      for (const [name, open] of SCREENS) {
        await open(page);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        await test.step(name, () => expectNoAxeViolations(page));
      }
    });
    test(`the empty screens have no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await fakeServer(page);
      for (const [name, open] of EMPTY_SCREENS) {
        await open(page);
        if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
        await test.step(name, () => expectNoAxeViolations(page));
      }
    });
  }
});
