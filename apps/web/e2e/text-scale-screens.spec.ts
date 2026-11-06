import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer, WEEKS } from "./fake-server";
import { asAndroid } from "./native";

// The key screens keep their text whole at the phone's largest text sizes: nothing cut, nothing
// sideways, nothing under the dock, every target still 44 px.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
});

const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const MONDAY = "2026-10-05T16:00:00.000Z";
const LAST_A: Change[] = [
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
const RUNNING_A: Change[] = [
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
const sessionBar = (page: Page) =>
  page.getByRole("region", { name: "Session in progress" }).getByRole("link");

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
    "Sessions",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workouts?tab=program");
      await expect(page.getByRole("radio", { name: /program/i })).toBeChecked();
    },
  ],
  [
    "the session preview",
    async (page) => {
      await fakeServer(page, { changes: LAST_A });
      await page.goto("/workouts/session/A?from=home");
      await expect(page.getByRole("link", { name: "Start the session" })).toBeVisible();
    },
  ],
  [
    "Home with a session open",
    async (page) => {
      await fakeServer(page, { changes: RUNNING_A });
      await page.goto("/");
      await expect(sessionBar(page)).toContainText("Set 1 of 4");
    },
  ],
  [
    "the session cover",
    async (page) => {
      await fakeServer(page, { changes: RUNNING_A });
      await page.goto("/");
      await sessionBar(page).click();
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

// Text whose box is wider or taller inside than out while its style hides the rest: a truncate,
// a line clamp, or a hidden overflow. A control's label wider than the control counts too: the
// page clips it further up.
const cutText = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => {
        if (el.closest("[aria-hidden=true], [inert], svg, .sr-only")) return false;
        if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim() !== ""))
          return false;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return false;
        const clamped = s.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 1;
        const clipped = s.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1;
        const spills = el.matches("a, button") && el.scrollWidth > el.clientWidth + 1;
        return clamped || clipped || spills;
      })
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${el.textContent!.trim().slice(0, 40)}" ${el.scrollWidth}/${el.clientWidth} ${el.className}`,
      ),
  );

// The 44 px rule of gates.spec.ts: a link inside a sentence is exempt, a field counts by its box.
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
        const name = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? "";
        const box = el.getBoundingClientRect();
        return `${el.tagName.toLowerCase()} "${name}" ${Math.round(box.width)} × ${Math.round(box.height)}`;
      }),
  );

// Scrolled to the end, the controls and rows still on screen that the dock covers.
const underDock = (page: Page) =>
  page.evaluate(async () => {
    const dock = document.querySelector<HTMLElement>("[data-dock]");
    const open = document.querySelector("[role=dialog]") !== null;
    if (!dock || open) return [];
    for (const el of [document.scrollingElement, document.querySelector("main")])
      if (el) el.scrollTop = el.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const bar = dock.getBoundingClientRect();
    return [...document.querySelectorAll<HTMLElement>("main :is(li, button, a, input, p, h1, h2)")]
      .filter((el) => !el.closest("[aria-hidden=true], [inert]"))
      .filter((el) => {
        const box = el.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1 || box.top >= bar.top + 1) return false;
        return box.bottom > bar.top + 1 && box.top < bar.bottom;
      })
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent!.trim().slice(0, 40)}"`);
  });

// The last thing on the page ends above the dock once scrolled to the end.
const lastRowClears = (page: Page) =>
  page.evaluate(() => {
    const dock = document.querySelector<HTMLElement>("[data-dock]");
    const main = document.querySelector("main");
    if (!dock || !main || document.querySelector("[role=dialog]")) return null;
    const bottom = Math.max(
      ...[...main.querySelectorAll<HTMLElement>("*")]
        .filter((el) => el.getBoundingClientRect().height > 0)
        .map((el) => el.getBoundingClientRect().bottom),
    );
    return bottom - dock.getBoundingClientRect().top;
  });

for (const width of [360, 390]) {
  for (const textScale of [2, 2.35]) {
    for (const [name, open] of SCREENS) {
      test(`text scale x${textScale} at ${width} px holds ${name}`, async ({ page }) => {
        await asAndroid(page, { textScale });
        await page.setViewportSize({ width, height: 800 });
        await open(page);
        await expect(page.locator(".launch")).toBeHidden();
        await settled(page);

        expect(await cutText(page), "cut text").toEqual([]);
        expect(await smallTargets(page), "small targets").toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "sideways scroll",
        ).toBe(true);
        expect(await underDock(page), "under the dock").toEqual([]);
        const gap = await lastRowClears(page);
        if (gap !== null) expect(gap, "the last row clears the dock").toBeLessThanOrEqual(0);
      });
    }
  }
}

// The exercise list in French, whose muscle and equipment words run longest: each row grows with
// its name and line, so no text spills over the hairline of the row above or below it. A row keeps
// one line of each, ending in an ellipsis: the list only renders what is on screen, which needs
// every row the same height.
test.describe("in French", () => {
  test.use({ locale: "fr-FR" });

  // Rows whose text sticks out of the row's own box, top or bottom.
  const spilledRows = (page: Page) =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("main li a")].flatMap((row) => {
        const box = row.getBoundingClientRect();
        return [...row.querySelectorAll<HTMLElement>("span")]
          .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3))
          .filter((el) => {
            const text = el.getBoundingClientRect();
            return text.top < box.top - 0.5 || text.bottom > box.bottom + 0.5;
          })
          .map((el) => `"${el.textContent!.trim().slice(0, 40)}"`);
      }),
    );

  for (const width of [360, 390]) {
    for (const textScale of [2, 2.35]) {
      test(`text scale x${textScale} at ${width} px holds the exercise list`, async ({ page }) => {
        await asAndroid(page, { textScale });
        await page.setViewportSize({ width, height: 800 });
        await fakeServer(page, { changes: LAST_A });
        await page.goto("/workouts?tab=exercises");
        await expect(page.getByRole("heading", { name: "Dans ton programme" })).toBeVisible();
        await expect(page.locator(".launch")).toBeHidden();
        await settled(page);

        expect(await spilledRows(page), "text out of its row").toEqual([]);
        expect(await smallTargets(page), "small targets").toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "sideways scroll",
        ).toBe(true);
      });
    }
  }
});

// The French labels run longest. At the phone's largest sizes, past what the screens above are held
// to, a page keeps every word on screen: nothing cut, nothing sideways.
test.describe("in French at the largest sizes", () => {
  test.use({ locale: "fr-FR" });

  const LONGEST: [string, string, (page: Page) => Promise<void>][] = [
    [
      "the session preview",
      "/workouts/session/A?from=home",
      (page) => expect(page.getByRole("link", { name: "Commencer la séance" })).toBeVisible(),
    ],
  ];

  for (const width of [360, 390]) {
    for (const textScale of [2.35, 3.12]) {
      for (const [name, path, ready] of LONGEST) {
        test(`text scale x${textScale} at ${width} px keeps ${name} whole`, async ({ page }) => {
          await asAndroid(page, { textScale });
          await page.setViewportSize({ width, height: 800 });
          await fakeServer(page, { changes: LAST_A });
          await page.goto(path);
          await ready(page);
          await expect(page.locator(".launch")).toBeHidden();
          await settled(page);

          expect(await cutText(page), "cut text").toEqual([]);
          expect(await smallTargets(page), "small targets").toEqual([]);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            "sideways scroll",
          ).toBe(true);
        });
      }
    }
  }
});
