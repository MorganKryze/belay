import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer, refuseChanges, WEEKS } from "./fake-server";

// Wednesday 7 October 2026, 6 p.m. in Paris; the clock stands still.
const NOW = new Date("2026-10-07T18:00:00+02:00");
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

const PHONE = { width: 390, height: 844 };
const SMALL = { width: 360, height: 780 };
const DESKTOP = { width: 1280, height: 800 };

// Session A on Monday, ended, as another device sent it: the history and its detail have a row.
const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const MONDAY = "2026-10-05T16:00:00.000Z";
const IRON = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e09";
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: MONDAY,
    at: MONDAY,
  },
  { kind: "workout", id: LAST, field: "ended", value: "2026-10-05T17:04:00.000Z", at: MONDAY },
];

// Session C started ten minutes ago, still open.
const RUNNING = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const TEN_AGO = new Date(NOW.getTime() - 10 * 60_000).toISOString();
const RUNNING_C: Change[] = [
  {
    kind: "workout",
    id: RUNNING,
    field: "start",
    sessionCode: "C",
    plan: [...sessionByCode("C")!.slots],
    startedAt: TEN_AGO,
    at: TEN_AGO,
  },
];

// Session A started at 16:00 on the frozen day and ended 48 minutes later.
const DONE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f02";
const DONE_A: Change[] = [
  {
    kind: "workout",
    id: DONE,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: "2026-10-07T14:00:00.000Z",
    at: "2026-10-07T14:00:00.000Z",
  },
  {
    kind: "workout",
    id: DONE,
    field: "ended",
    value: "2026-10-07T14:48:00.000Z",
    at: "2026-10-07T14:48:00.000Z",
  },
];

// Every visible control under 44 × 44 px, described for the failure message. A link inside a
// sentence is exempt: it flows with the text around it, as WCAG 2.5.8 allows. Whatever an open
// dialog hides from assistive tech is out of reach, so it is not measured either. A field takes
// taps on its whole box (the stepper's, or the label it sits in), so that box is what counts.
const smallTargets = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("button, a, input, [role=radio], [role=option]")]
      .filter((el) => {
        if (el.closest("[aria-hidden=true], [inert]")) return false;
        const target = (el.tagName === "INPUT" && el.closest(".field, label")) || el;
        const box = target.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) return false;
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || Number(style.opacity) === 0) return false;
        const line = el.parentElement;
        const inText =
          el.tagName === "A" &&
          line !== null &&
          [...line.childNodes].some(
            (n) => n !== el && n.nodeType === Node.TEXT_NODE && n.textContent!.trim() !== "",
          );
        return !inText && (box.width < 44 || box.height < 44);
      })
      .map((el) => {
        const box = (
          (el.tagName === "INPUT" && el.closest(".field, label")) ||
          el
        ).getBoundingClientRect();
        const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
        return `${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)} × ${Math.round(box.height)}`;
      }),
  );

async function expectTargets(page: Page) {
  await settled(page);
  expect(await smallTargets(page)).toEqual([]);
}

// The page and every open dialog or list, each wider inside than its box.
async function expectFits(page: Page) {
  await settled(page);
  const wide = await page.evaluate(() =>
    [document.documentElement, ...document.querySelectorAll("[role=dialog], [role=listbox]")]
      .filter((el) => el.scrollWidth > el.clientWidth)
      .map((el) => `${el.tagName.toLowerCase()} ${el.scrollWidth} > ${el.clientWidth}`),
  );
  expect(wide).toEqual([]);
}

const heading = (page: Page) => expect(page.locator("main h1").first()).toBeVisible();

// Session C taken up on this device, then lowered: Accueil with the session bar on a phone.
async function lowerSession(page: Page) {
  await fakeServer(page, { changes: RUNNING_C });
  await page.goto("/workout?start=C");
  await expect(page.locator(".launch")).toBeHidden();
  await page.getByRole("button", { name: "Minimize the session" }).click();
  await expect(page.getByRole("region", { name: /^Session C · / })).toContainText("In progress");
}

// Session A started on this device, one set logged, then Finish tapped.
async function finishWithOneSet(page: Page) {
  await fakeServer(page, { changes: LAST_A });
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  const bench = page.getByRole("region", { name: /^Barbell bench press/ });
  await bench.getByRole("textbox", { name: "Load of set 1, kg" }).fill("60");
  await bench.getByRole("textbox", { name: "Reps of set 1" }).fill("8");
  await bench.getByRole("button", { name: "Log set 1" }).click();
  await expect(bench.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
}

// Each screen, opened as a person reaches it, with its dialog up when it has one.
const SCREENS: [string, (page: Page) => Promise<void>][] = [
  [
    "Home",
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();
    },
  ],
  [
    "Home, a session open",
    async (page) => {
      await fakeServer(page, { changes: RUNNING_C });
      await page.goto("/");
      await expect(page.getByRole("region", { name: /^Session C · / })).toContainText(
        "In progress",
      );
    },
  ],
  [
    "Home, the session done",
    async (page) => {
      await fakeServer(page, { changes: DONE_A });
      await page.goto("/");
      await expect(page.getByRole("region", { name: /^Session A · / })).toContainText("Done today");
    },
  ],
  ...(["program", "history", "exercises"] as const).map(
    (tab): [string, (page: Page) => Promise<void>] => [
      `Sessions, ${tab}`,
      async (page) => {
        await fakeServer(page, { changes: LAST_A });
        await page.goto(`/workouts?tab=${tab}`);
        await expect(page.getByRole("radio", { name: new RegExp(tab, "i") })).toBeChecked();
        if (tab === "history")
          await expect(page.getByRole("button", { name: "Previous month" })).toBeVisible();
        if (tab === "exercises") await expect(page.locator("main li a").first()).toBeVisible();
      },
    ],
  ),
  [
    "the session preview",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workouts/session/A?from=home");
      await expect(page.getByRole("link", { name: "Start the session" })).toBeVisible();
    },
  ],
  [
    "Body",
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/body");
      await heading(page);
    },
  ],
  [
    "Tools",
    async (page) => {
      await fakeServer(page);
      await page.goto("/tools");
      await heading(page);
    },
  ],
  [
    "the lowered session on Outils",
    async (page) => {
      await lowerSession(page);
      await page.locator("a[href='/tools']:visible").click();
      await heading(page);
    },
  ],
  [
    "Settings with its language menu open",
    async (page) => {
      await fakeServer(page);
      await page.goto("/settings");
      await page.getByRole("combobox", { name: /^Language/ }).click();
      await expect(page.getByRole("listbox")).toBeVisible();
    },
  ],
  [
    "Settings with the sign-out sheet open",
    async (page) => {
      await fakeServer(page);
      await page.goto("/settings");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page.getByRole("dialog", { name: "Sign out?" })).toBeVisible();
    },
  ],
  [
    "Profile",
    async (page) => {
      await fakeServer(page, {
        changes: [{ kind: "profile", field: "height", value: 178, at: MONDAY }],
      });
      await page.goto("/settings/profile");
      await expect(page.getByRole("button", { name: "Clear Height" })).toBeVisible();
    },
  ],
  [
    "empty Profile",
    async (page) => {
      await fakeServer(page);
      await page.goto("/settings/profile");
      await expect(page.getByRole("button", { name: "Fill in Height" })).toBeVisible();
    },
  ],
  [
    "My supplements",
    async (page) => {
      await fakeServer(page, {
        changes: [{ kind: "supplement", id: IRON, field: "name", value: "Iron", at: MONDAY }],
      });
      await page.goto("/settings/supplements");
      await page.getByRole("button", { name: "More for Iron" }).click();
      await expect(page.getByRole("button", { name: "Rename" })).toBeVisible();
    },
  ],
  [
    "empty My supplements",
    async (page) => {
      await fakeServer(page);
      await page.goto("/settings/supplements");
      await expect(page.getByRole("button", { name: "Add a supplement" })).toBeVisible();
    },
  ],
  [
    "the weigh-in sheet",
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await page.getByRole("button", { name: /^Weigh-in/ }).click();
      await expect(page.getByRole("dialog", { name: "Weigh-in" })).toBeVisible();
    },
  ],
  [
    "the session screen, a set logged and a rest running",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workout?start=A");
      await expect(page.locator(".launch")).toBeHidden();
      const bench = page.getByRole("region", { name: /^Barbell bench press/ });
      await bench.getByRole("textbox", { name: "Load of set 1, kg" }).fill("60");
      await bench.getByRole("textbox", { name: "Reps of set 1" }).fill("8");
      await bench.getByRole("button", { name: "Log set 1" }).click();
      await expect(bench.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
      await expect(page.getByRole("timer")).toBeVisible();
    },
  ],
  [
    "the paused session",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workout?start=A");
      await expect(page.locator(".launch")).toBeHidden();
      await page.getByRole("button", { name: "Pause the session" }).click();
      await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
    },
  ],
  [
    "the finish sheet",
    async (page) => {
      await finishWithOneSet(page);
      await expect(page.getByRole("dialog", { name: "Finish the session?" })).toBeVisible();
    },
  ],
  [
    "the delete-session confirmation",
    async (page) => {
      await finishWithOneSet(page);
      await page.getByRole("button", { name: "Delete the session…" }).click();
      await expect(page.getByRole("dialog", { name: "Delete the session?" })).toBeVisible();
    },
  ],
  [
    "the nothing-logged sheet",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workout?start=A");
      await expect(page.locator(".launch")).toBeHidden();
      await page.getByRole("button", { name: "Finish", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Nothing logged yet" })).toBeVisible();
    },
  ],
  [
    "the remove-session action sheet",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workouts?tab=history");
      await page.getByRole("link", { name: /Session A · Push/ }).click();
      await page.getByRole("button", { name: "Delete this session" }).click();
      await expect(page.getByRole("dialog", { name: "Delete this session?" })).toBeVisible();
    },
  ],
  [
    "the summary",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto(`/workout/summary/${LAST}`);
      await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
    },
  ],
];

for (const viewport of [PHONE, DESKTOP]) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });
    for (const [name, open] of SCREENS)
      test(`every control is at least 44 × 44 on ${name}`, async ({ page }) => {
        await open(page);
        await expectTargets(page);
      });
  });
}

for (const viewport of [SMALL, PHONE, DESKTOP]) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });
    for (const [name, open] of SCREENS)
      test(`nothing scrolls sideways on ${name}`, async ({ page }) => {
        await open(page);
        await expectFits(page);
      });
  });
}

// Every field a person can type in whose text is under 16 px: iOS Safari zooms the page onto such a
// field on focus and leaves it zoomed after. An invisible field over a chip still takes the focus,
// so it counts too; only boxes, radios and what an open dialog hides are left out.
const smallFields = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("input, textarea, select")]
      .filter((el) => {
        if (el.closest("[aria-hidden=true], [inert]")) return false;
        if (["checkbox", "radio", "range", "hidden"].includes(el.getAttribute("type") ?? "")) {
          return false;
        }
        const box = el.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) return false;
        return parseFloat(getComputedStyle(el).fontSize) < 16;
      })
      .map((el) => {
        const name = el.getAttribute("aria-label") ?? el.id;
        return `${el.tagName.toLowerCase()} "${name}" ${getComputedStyle(el).fontSize}`;
      }),
  );

// The screens above, and those whose fields only show after a tap: a tool, the editor, the
// exercise picker, the annotation sheet, an exercise's note.
const FIELD_SCREENS: [string, (page: Page) => Promise<void>][] = [
  ...SCREENS,
  [
    "a tool",
    async (page) => {
      await fakeServer(page);
      await page.goto("/tools/bmi");
      await expect(page.getByRole("textbox", { name: "Weight" })).toBeVisible();
    },
  ],
  [
    "the editor",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto(`/workout/edit?id=${LAST}`);
      await page.getByRole("button", { name: /^Barbell bench press/ }).click();
      await page.getByRole("button", { name: "+ Set" }).click();
      await expect(page.getByRole("textbox", { name: /^Load of set 1/ })).toBeVisible();
    },
  ],
  [
    "the exercise picker",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workout?start=A");
      await expect(page.locator(".launch")).toBeHidden();
      const bench = page.getByRole("region", { name: /^Barbell bench press/ });
      await bench.getByRole("button", { name: "Replace" }).click();
      await expect(page.getByRole("dialog").getByRole("searchbox")).toBeVisible();
    },
  ],
  [
    "the annotation sheet",
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/body");
      await page.getByRole("button", { name: "Annotation", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "New annotation" })).toBeVisible();
    },
  ],
  [
    "an exercise's note",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workout?start=A");
      await expect(page.locator(".launch")).toBeHidden();
      const bench = page.getByRole("region", { name: /^Barbell bench press/ });
      await bench.getByRole("button", { name: "Note", exact: true }).click();
      await expect(bench.getByRole("textbox", { name: /^Note on/ })).toBeVisible();
    },
  ],
];

test.describe(`at ${PHONE.width} px`, () => {
  test.use({ viewport: PHONE });
  for (const [name, open] of FIELD_SCREENS)
    test(`every field keeps 16 px text on ${name}`, async ({ page }) => {
      await open(page);
      await settled(page);
      expect(await smallFields(page)).toEqual([]);
    });
});

// The way to the settings and the pages under them, from the avatar.
async function avatarToSupplements(page: Page, around: "main" | "banner") {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await page.getByRole(around).getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: /^Supplements/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "My supplements" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("link", { name: /^Ada Profile/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Profile" })).toBeVisible();
}

async function bannerToSettings(page: Page) {
  await fakeServer(page, { rows: WEEKS });
  await refuseChanges(page);
  await page.goto("/");
  await page.getByRole("button", { name: /^Weigh-in/ }).click();
  const sheet = page.getByRole("dialog", { name: "Weigh-in" });
  await sheet.getByRole("textbox", { name: "Weight" }).fill("80.5");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("An entry was refused.")).toBeVisible();
  await page.getByRole("link", { name: "See details" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
}

const TABS: [string, RegExp][] = [
  ["Sessions", /^\/workouts/],
  ["Body", /^\/body/],
  ["Tools", /^\/tools/],
  ["Home", /^\/$/],
];

async function eachTab(page: Page, bar: ReturnType<Page["getByRole"]>) {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  for (const [name, path] of TABS) {
    const link = bar.getByRole("link", { name, exact: true });
    await link.click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(path);
    await expect(link).toHaveAttribute("aria-current", "page");
    await heading(page);
  }
}

test.describe("every action stays reachable on a phone", () => {
  test.use({ viewport: PHONE });
  test("avatar, Settings, supplements, Profile", ({ page }) => avatarToSupplements(page, "main"));
  test("the sync banner's link to Settings", ({ page }) => bannerToSettings(page));
  test("the session bar resumes the running session", async ({ page }) => {
    await fakeServer(page, { changes: RUNNING_C });
    await page.goto("/tools");
    await page.getByRole("link", { name: /In progress · set \d+ of \d+ · Session C/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Session C · / })).toBeVisible();
  });
  test("a tool stays reachable while a session is lowered, and the bar raises it", async ({
    page,
  }) => {
    await lowerSession(page);
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Tools" })
      .click();
    await page.getByRole("link", { name: /^Plates/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Plates" })).toBeVisible();
    await page.getByRole("link", { name: /In progress · set \d+ of \d+ · Session C/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Session C · / })).toBeVisible();
  });
  test("each tab from the dock", ({ page }) =>
    eachTab(page, page.getByRole("navigation", { name: "Main" })));
});

test.describe("every action stays reachable on a computer", () => {
  test.use({ viewport: DESKTOP });
  test("avatar, Settings, supplements, Profile", ({ page }) => avatarToSupplements(page, "banner"));
  test("the sync banner's link to Settings", ({ page }) => bannerToSettings(page));
  test("Home's session card resumes the running session", async ({ page }) => {
    await fakeServer(page, { changes: RUNNING_C });
    await page.goto("/");
    const card = page.getByRole("region", { name: /^Session C · / });
    await expect(card).toContainText("In progress");
    await card.getByRole("link", { name: "Resume" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Session C · / })).toBeVisible();
  });
  test("each tab from the top bar", ({ page }) => eachTab(page, page.getByRole("banner")));
});
