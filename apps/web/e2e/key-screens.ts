import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

// Session A on Monday, ended: the summary has its figures.
export const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const MONDAY = "2026-10-05T16:00:00.000Z";
export const LAST_A: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt: MONDAY,
    at: MONDAY,
  },
  { kind: "workout", id: LAST, field: "ended", value: "2026-10-05T17:04:00.000Z", at: MONDAY },
];

// A session started at 17:40 and still running at the frozen 18:00.
const OPEN = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e02";
const STARTED = "2026-10-07T15:40:00.000Z";
export const RUNNING_A: Change[] = [
  {
    kind: "workout",
    id: OPEN,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt: STARTED,
    at: STARTED,
  },
];
export const sessionBar = (page: Page) =>
  page.getByRole("region", { name: "Session in progress" }).getByRole("link");

// The eight key screens, each opened and drawn.
export const SCREENS: [string, (page: Page) => Promise<void>][] = [
  [
    "Home",
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();
    },
  ],
  [
    "Sessions",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workouts?tab=program");
      await expect(page.getByRole("radio", { name: /program/i })).toBeChecked();
    },
  ],
  [
    "the session cover",
    async (page) => {
      await fakeServer(page, { changes: RUNNING_A });
      await page.goto("/");
      // A computer's width has no session bar: the session card resumes it.
      const wide = page.viewportSize()!.width >= 1024;
      await (wide ? page.getByRole("link", { name: "Resume" }) : sessionBar(page)).click();
      await expect(page.getByRole("button", { name: "Minimize the session" })).toBeVisible();
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
  [
    "Body",
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/body");
      await expect(page.locator("main h1").first()).toBeVisible();
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
    "Tools",
    async (page) => {
      await fakeServer(page);
      await page.goto("/tools");
      await expect(page.locator("main h1").first()).toBeVisible();
    },
  ],
  [
    "Settings",
    async (page) => {
      await fakeServer(page);
      await page.goto("/settings");
      await expect(page.locator("main h1").first()).toBeVisible();
    },
  ],
];
