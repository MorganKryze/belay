import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";
import { type Motion, readMotion, recordMotion } from "./motion";

// Wednesday 7 October 2026, 6 p.m. in Paris; the clock stands still.
const NOW = new Date("2026-10-07T18:00:00+02:00");
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await recordMotion(page);
});

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const NAV = "cubic-bezier(0.32, 0.72, 0, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";
const PILL = "linear(0 0%, 0.2 10%, 0.6 25%, 0.9 40%, 1.03 55%, 1.01 70%, 1 100%)";
const POP = "linear(0 0%, 0.5 18%, 0.9 35%, 1.06 52%, 1.02 70%, 1 100%)";

// Session C started ten minutes ago, still open.
const TEN_AGO = new Date(NOW.getTime() - 10 * 60_000).toISOString();
const RUNNING_C: Change[] = [
  {
    kind: "workout",
    id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01",
    field: "start",
    sessionCode: "C",
    plan: [...sessionByCode("C")!.slots],
    startedAt: TEN_AGO,
    at: TEN_AGO,
  },
];

// What ran since the last call: the list is read, then emptied.
const since = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { motion: Motion[] };
    return w.motion.splice(0);
  });

async function openHome(page: Page) {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Intake/ })).toBeVisible();
  // The launch screen holds its second over Home: a touch before it goes lands on it.
  await expect(page.locator(".launch")).toBeHidden();
}

async function saveWeighIn(page: Page) {
  await page.getByRole("button", { name: /^Weigh-in/ }).click();
  const sheet = page.getByRole("dialog", { name: "Weigh-in" });
  await sheet.getByRole("textbox", { name: "Weight" }).fill("80.5");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
}

test.describe("normal motion", () => {
  test("a pressed button scales to 0.97 at once and springs back in 200 ms", async ({ page }) => {
    await openHome(page);
    // The avatar shares the press of every button.
    const button = page.getByRole("link", { name: "Settings" });
    await button.hover();
    await since(page);
    await page.mouse.down();
    // Read once, with no wait: the press shows on the frame the finger lands.
    expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe(
      "matrix(0.97, 0, 0, 0.97, 0, 0)",
    );
    // Released away from it, so Home stays.
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({
          kind: "transition",
          duration: 200,
          easing: NAV,
          transforms: true,
          scales: true,
        }),
      );
  });

  test("a pressed row tints across its whole width before the finger lifts", async ({ page }) => {
    await openHome(page);
    const row = page.getByRole("button", { name: /^Intake/ });
    await row.hover();
    await page.mouse.down();
    const pressed = await row.evaluate((el) => ({
      tint: getComputedStyle(el).backgroundColor,
      width: el.getBoundingClientRect().width,
      line: el.parentElement!.getBoundingClientRect().width,
    }));
    expect(pressed.tint).not.toBe("rgba(0, 0, 0, 0)");
    expect(pressed.width).toBe(pressed.line);
    await page.mouse.move(0, 0);
    await page.mouse.up();
  });

  test("a row held under a finger tints while the finger stays down", async ({ page }) => {
    await openHome(page);
    const row = page.getByRole("button", { name: /^Intake/ });
    const box = (await row.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // A real touch, not a mouse: the browser may hold back the press state to tell a tap from a
    // scroll, and only a touch goes through that.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    // Polled while the finger stays down: a slow runner may take a few frames to deliver the press.
    await expect
      .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2000 })
      .not.toBe("rgba(0, 0, 0, 0)");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  });

  test("a tab switch slides only the pill, in 300 ms on its overshooting curve", async ({
    page,
  }) => {
    await openHome(page);
    await since(page);
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Tools" })
      .click();
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
    await expect.poll(async () => (await readMotion(page)).length).toBeGreaterThan(0);
    const moving = (await readMotion(page)).filter((m) => m.transforms);
    expect(moving).toEqual([
      expect.objectContaining({
        target: "span[data-pill]",
        duration: 300,
        easing: PILL,
        transforms: true,
        scales: false,
        kind: "transition",
      }),
    ]);
  });

  test("a pressed tab's icon scales to 0.92 in 90 ms and back in 200 ms on the nav curve", async ({
    page,
  }) => {
    await openHome(page);
    const icon = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Tools" })
      .locator("svg");
    await icon.hover();
    await since(page);
    await page.mouse.down();
    await expect
      .poll(() => icon.evaluate((el) => getComputedStyle(el).transform))
      .toBe("matrix(0.92, 0, 0, 0.92, 0, 0)");
    const dip = { target: "svg", kind: "transition", transforms: true, scales: true } as const;
    expect(await since(page)).toContainEqual(expect.objectContaining({ ...dip, duration: 90 }));
    // Released away from it, so Home stays.
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(expect.objectContaining({ ...dip, duration: 200, easing: NAV }));
  });

  test("the segmented thumb slides in 220 ms", async ({ page }) => {
    await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
    await page.goto("/tools/protein");
    const radios = page.getByRole("radiogroup", { name: "Your goal" }).getByRole("radio");
    await expect(radios.first()).toBeVisible();
    await since(page);
    await radios.last().click();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({
          target: "span[data-slot]",
          duration: 220,
          easing: NAV,
          transforms: true,
          kind: "transition",
        }),
      );
  });

  test("a checked set pops its tick in 180 ms and tints its row in 140 ms", async ({ page }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/workout?start=A");
    const bench = page.getByRole("region", { name: /^Barbell bench press/ });
    await bench.getByRole("textbox", { name: "Load of set 1, kg" }).fill("60");
    await bench.getByRole("textbox", { name: "Reps of set 1" }).fill("8");
    await bench.getByRole("button", { name: "Log set 1" }).click();
    await expect(bench.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
    await expect
      .poll(() => readMotion(page))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target: "svg",
            duration: 180,
            easing: POP,
            transforms: true,
            scales: true,
            kind: "animation",
          }),
          expect.objectContaining({
            target: "div",
            duration: 140,
            easing: OUT,
            transforms: false,
            kind: "transition",
          }),
        ]),
      );
  });

  test("a toast rises in 220 ms and fades out in 140 ms", async ({ page }) => {
    await openHome(page);
    await saveWeighIn(page);
    const toast = { target: "div", kind: "animation" } as const;
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({ ...toast, duration: 220, easing: OUT, transforms: true }),
      );
    await page.getByRole("button", { name: "Undo" }).click();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({ ...toast, duration: 140, easing: EXIT, transforms: false }),
      );
  });

  test("the dock fades under a sheet in 350 ms", async ({ page }) => {
    await openHome(page);
    await since(page);
    await page.getByRole("button", { name: /^Intake/ }).click();
    await expect(page.getByRole("dialog", { name: "Intake" })).toBeVisible();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({
          target: "div[data-dock]",
          duration: 350,
          easing: OUT,
          transforms: false,
          kind: "transition",
        }),
      );
  });

  test("a row keeps its tint through the push and clears it in 250 ms on Back", async ({
    page,
  }) => {
    // The row still marked pressed when the page change starts, so the leaving page shows it.
    await page.addInitScript(() => {
      const w = window as unknown as { held: (string | null)[] };
      w.held = [];
      const start = document.startViewTransition?.bind(document);
      if (!start) return;
      document.startViewTransition = ((arg: StartViewTransitionOptions) => {
        w.held.push(document.querySelector("a[data-pressed]")?.getAttribute("href") ?? null);
        return start(arg);
      }) as typeof document.startViewTransition;
    });
    const held = () => page.evaluate(() => (window as unknown as { held: string[] }).held);
    await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
    await page.goto("/tools");
    await page.getByRole("link", { name: /^Plates/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Plates" })).toBeVisible();
    await expect.poll(held).toEqual(["/tools/plates"]);
    await since(page);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({
          target: expect.stringMatching(/^a\[.*data-untint\]/),
          duration: 250,
          easing: OUT,
          transforms: false,
          kind: "transition",
        }),
      );
  });

  test("the session bar rises in 220 ms", async ({ page }) => {
    await fakeServer(page, { rows: WEEKS, changes: RUNNING_C });
    await page.goto("/");
    await expect(page.getByRole("link", { name: /In progress/ })).toBeVisible();
    await expect
      .poll(() => readMotion(page))
      .toContainEqual(
        expect.objectContaining({
          target: "a",
          duration: 220,
          easing: OUT,
          transforms: true,
          kind: "animation",
        }),
      );
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion a sheet slides in and out in 300 ms on the out curve over a 200 ms veil", async ({
    page,
  }) => {
    await openHome(page);
    await since(page);
    await page.getByRole("button", { name: /^Intake/ }).click();
    const intake = page.getByRole("dialog", { name: "Intake" });
    await expect(intake).toBeVisible();
    await intake.getByRole("button", { name: "Close" }).click();
    await expect(intake).toBeHidden();
    const card = { target: "div[role=dialog][data-state]", kind: "animation" } as const;
    const veil = { target: expect.stringContaining("[data-sheet-overlay]"), kind: "animation" };
    const slide = { duration: 300, easing: OUT, transforms: true, scales: false };
    const fade = { duration: 200, easing: OUT, transforms: false };
    const ran = await readMotion(page);
    // The way in, then the way out: the same slide and the same fade each time.
    expect(ran.filter((m) => m.target === card.target)).toEqual([
      expect.objectContaining({ ...card, ...slide }),
      expect.objectContaining({ ...card, ...slide }),
    ]);
    expect(ran.filter((m) => m.target.includes("[data-sheet-overlay]"))).toEqual([
      expect.objectContaining({ ...veil, ...fade }),
      expect.objectContaining({ ...veil, ...fade }),
    ]);
    expect(ran).toContainEqual(
      expect.objectContaining({ target: "div[data-dock]", kind: "transition", ...fade }),
    );
  });

  test("opening and closing a sheet, pushing and popping a page, switching tab, checking off a set and showing a toast scale nothing, slide only the sheet and the page, and fade in 200 ms at most", async ({
    page,
  }) => {
    const ran: Motion[] = [];
    await openHome(page);
    // Sheet in and out, then a toast.
    await page.getByRole("button", { name: /^Intake/ }).click();
    const intake = page.getByRole("dialog", { name: "Intake" });
    await expect(intake).toBeVisible();
    await intake.getByRole("button", { name: "Close" }).click();
    await expect(intake).toBeHidden();
    await saveWeighIn(page);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Undo" })).toBeHidden();
    // A tab switch, pressed down on the tab: neither the pill nor the icon moves.
    const tools = page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Tools" });
    await tools.hover();
    await page.mouse.down();
    expect(await tools.locator("svg").evaluate((el) => getComputedStyle(el).transform)).toMatch(
      /^(none|matrix\(1, 0, 0, 1, 0, 0\))$/,
    );
    await page.mouse.up();
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
    const tabbed = await readMotion(page);
    expect(tabbed.filter((m) => m.target === "span[data-pill]")).toEqual([]);
    expect(tabbed.filter((m) => m.target === "svg" && m.transforms)).toEqual([]);
    // A push and a pop. The new heading shows before the page snapshots start to slide, and a
    // Back taken in that gap cuts the push short, so each one waits for its slide to be seen.
    const slides = async () =>
      (await readMotion(page)).filter((m) => m.target.startsWith("::view-transition")).length;
    await page.getByRole("link", { name: /^Plates/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Plates" })).toBeVisible();
    await expect.poll(slides).toBeGreaterThan(0);
    const pushed = await slides();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
    await expect.poll(slides).toBeGreaterThan(pushed);
    ran.push(...(await readMotion(page)));
    // A set checked off.
    await page.goto("/workout?start=A");
    const bench = page.getByRole("region", { name: /^Barbell bench press/ });
    await bench.getByRole("textbox", { name: "Load of set 1, kg" }).fill("60");
    await bench.getByRole("textbox", { name: "Reps of set 1" }).fill("8");
    await bench.getByRole("button", { name: "Log set 1" }).click();
    await expect(bench.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
    ran.push(...(await readMotion(page)));

    // The fades did run: the check is not passing on an empty list.
    expect(ran.filter((m) => m.target.startsWith("::view-transition")).length).toBeGreaterThan(0);
    expect(ran.filter((m) => m.target === "div[role=dialog][data-state]").length).toBeGreaterThan(
      0,
    );
    expect(ran.filter((m) => m.scales)).toEqual([]);
    expect(ran.filter((m) => m.duration > 300)).toEqual([]);
    expect(ran.filter((m) => m.transforms)).not.toEqual([]);
    expect(ran.filter((m) => m.transforms && m.target.startsWith("::view-transition"))).not.toEqual(
      [],
    );
    // Only the sheet card and the page snapshots slide.
    const sliding = /^(div\[role=dialog\]\[data-state\]|::view-transition-(new|old)\(root\))$/;
    for (const moving of ran.filter((m) => m.transforms)) {
      expect(moving).toEqual(
        expect.objectContaining({
          target: expect.stringMatching(sliding),
          duration: 300,
          easing: OUT,
        }),
      );
    }
    expect(ran.filter((m) => !m.transforms && m.duration > 200)).toEqual([]);
  });
});
