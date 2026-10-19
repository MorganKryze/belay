import { expect, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";
import { readMotion, recordMotion } from "./motion";

// No frozen clock here: the sheet's timings are read on the page's own clock.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

type Played = {
  on: "card" | "overlay";
  name: string;
  duration: number;
  easing: string;
  properties: string[];
};

// The CSS animations running or held on the open sheet and its overlay, read from the page.
const played = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a): a is CSSAnimation => a instanceof CSSAnimation)
      .flatMap((a) => {
        const target = (a.effect as KeyframeEffect).target;
        const on = target?.matches("[role=dialog]")
          ? "card"
          : target?.matches("[data-sheet-overlay]")
            ? "overlay"
            : null;
        if (!on) return [];
        const timing = a.effect!.getTiming();
        const keyframes = (a.effect as KeyframeEffect).getKeyframes();
        const easing = keyframes[0]?.easing ?? "";
        // The animated properties, hyphenated, without the keyframe's own fields.
        const properties = [
          ...new Set(
            keyframes.flatMap((k) =>
              Object.keys(k)
                .filter((p) => !["offset", "computedOffset", "easing", "composite"].includes(p))
                .map((p) => p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)),
            ),
          ),
        ];
        return [
          { on, name: a.animationName, duration: Number(timing.duration), easing, properties },
        ];
      }),
  ) as Promise<Played[]>;

async function openIntake(page: Page) {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await page.getByRole("button", { name: /^Intake/ }).click();
  const sheet = page.getByRole("dialog", { name: "Intake" });
  await expect(sheet).toBeVisible();
  return sheet;
}

// Clicks the close button and reads the animations as soon as the card turns closed, long before
// its exit can end; getAnimations() brings styles up to date.
const closeAndRead = (page: Page) =>
  page.evaluate(async () => {
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    const turned = new Promise<void>((resolve) =>
      new MutationObserver((_, observer) => {
        observer.disconnect();
        resolve();
      }).observe(dialog, { attributeFilter: ["data-state"] }),
    );
    dialog.querySelector<HTMLElement>("button[aria-label=Close]")!.click();
    await turned;
    const attached = document.querySelector("[role=dialog]")?.getAttribute("data-state") ?? null;
    const running = document
      .getAnimations()
      .filter((a): a is CSSAnimation => a instanceof CSSAnimation)
      .filter((a) => a.playState === "running");
    const animations = running.map((a) => ({
      name: a.animationName,
      duration: Number(a.effect!.getTiming().duration),
      easing: (a.effect as KeyframeEffect).getKeyframes()[0]?.easing ?? "",
      card: (a.effect as KeyframeEffect).target?.matches("[role=dialog]") ?? false,
    }));
    // A start time is set on the animation's first frame: two frames on, both have one.
    for (let i = 0; i < 2; i++) await new Promise((resolve) => requestAnimationFrame(resolve));
    const started: Record<string, number> = {};
    for (const a of running) started[a.animationName] = Number(a.startTime);
    return { attached, animations, started };
  });

const SPRING_NAV =
  "linear(0 0%, 0.151 8.3%, 0.435 16.7%, 0.646 25%, 0.788 33.3%, 0.876 41.7%, 0.93 50%, 0.959 58.3%, 0.977 66.7%, 0.986 75%, 0.993 83.3%, 1 100%)";

// When the card's and the overlay's animations started, on the document timeline.
const starts = (page: Page) =>
  page.evaluate(() => {
    const at: Record<string, number> = {};
    for (const a of document.getAnimations()) {
      const target = (a.effect as KeyframeEffect).target;
      if (target?.matches("[role=dialog]")) at.card = Number(a.startTime);
      if (target?.matches("[data-sheet-overlay]")) at.overlay = Number(a.startTime);
    }
    return at;
  });

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";

test("a sheet rises in 500 ms on the nav spring, its veil darkening by its colour in 350 ms from the same frame", async ({
  page,
}) => {
  await openIntake(page);
  await expect
    .poll(() => played(page))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          on: "card",
          name: "sheet-in",
          duration: 500,
          easing: SPRING_NAV,
        }),
        {
          on: "overlay",
          name: "veil-in",
          duration: 350,
          easing: OUT,
          properties: ["background-color"],
        },
      ]),
    );
  const { card, overlay } = await starts(page);
  expect(Math.abs(card! - overlay!)).toBeLessThanOrEqual(17);
});

test("closing runs 300 ms down on the nav curve and a 300 ms linear veil from the same frame before the sheet leaves", async ({
  page,
}) => {
  const sheet = await openIntake(page);
  const { attached, animations, started } = await closeAndRead(page);
  expect(attached).toBe("closed");
  expect(animations).toEqual(
    expect.arrayContaining([
      { name: "sheet-out", duration: 300, easing: "cubic-bezier(0.32, 0.72, 0, 1)", card: true },
      { name: "veil-out", duration: 300, easing: "linear", card: false },
    ]),
  );
  expect(Math.abs(started["sheet-out"]! - started["veil-out"]!)).toBeLessThanOrEqual(17);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /^Intake/ })).toBeFocused();
});

// The alpha of a computed colour, whichever syntax the browser writes it in.
function alphaOf(colour: string): number {
  const slash = /\/\s*([\d.]+)\s*\)$/.exec(colour);
  if (slash) return Number(slash[1]);
  const parts = /^rgba?\(([^)]*)\)$/.exec(colour)?.[1]?.split(",") ?? [];
  if (parts.length === 4) return Number(parts[3]);
  if (parts.length === 3) return 1;
  throw new Error(`unread colour ${colour}`);
}

type Box = { x: number; y: number; width: number; height: number };

// What the page's hit test finds at a point: the veil, a card, or something else. Through the
// card, it reads what lies under the sheet at that point: a bar the card covers is still under
// the veil.
const hitAt = (page: Page, x: number, y: number, throughCard = false) =>
  page.evaluate(
    ([x, y, throughCard]) => {
      const card = (el: Element) => el.closest("[role=dialog], [role=alertdialog]");
      const hit = throughCard
        ? document.elementsFromPoint(x as number, y as number).find((el) => !card(el))
        : document.elementFromPoint(x as number, y as number);
      if (hit?.matches("[data-sheet-overlay]")) return "veil";
      if (hit && card(hit)) return "card";
      return hit?.outerHTML.slice(0, 80) ?? "nothing";
    },
    [x, y, throughCard] as const,
  );

const centre = (box: Box) => [box.x + box.width / 2, box.y + box.height / 2] as const;

// The veil spans the viewport, lies above the frosted header and the bars named, and under the
// card only. The open sheet hides the rest of the page from the accessibility tree, so the bars
// are found by tag.
async function expectVeilOverAll(page: Page, card: Box, bars: string[]) {
  const veil = page.locator("[data-sheet-overlay]");
  const rect = await veil.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
  const viewport = await page.evaluate(() => [0, 0, innerWidth, innerHeight]);
  expect(rect).toEqual(viewport);
  expect(await hitAt(page, 1, 1)).toBe("veil");
  const header = page.locator("[data-compact-title]").locator("xpath=../..");
  expect(await hitAt(page, ...centre((await header.boundingBox())!), true)).toBe("veil");
  for (const bar of bars) {
    const box = (await page.locator(bar).boundingBox())!;
    expect(await hitAt(page, ...centre(box), true), bar).toBe("veil");
  }
  expect(await hitAt(page, ...centre(card))).toBe("card");
}

for (const width of [390, 1280]) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`the veil covers the whole viewport above every bar and under its sheet only, ${width} px`, async ({
      page,
    }) => {
      const sheet = await openIntake(page);
      await settled(page);
      const bars = [width < 1024 ? "nav[aria-label=Main]" : "header"];
      await expectVeilOverAll(page, (await sheet.boundingBox())!, bars);
    });

    test(`the veil of an action sheet covers the whole viewport above every bar, ${width} px`, async ({
      page,
    }) => {
      await fakeServer(page);
      await page.goto("/settings");
      await page.getByRole("button", { name: "Sign out" }).click();
      const sheet = page.getByRole("dialog", { name: "Sign out?" });
      await expect(sheet).toBeVisible();
      await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      // Réglages is a deeper page on a phone: no dock under it.
      const bars = width < 1024 ? [] : ["header"];
      const card = (await sheet.locator("[data-action-card]").first().boundingBox())!;
      await expectVeilOverAll(page, card, bars);
    });
  });
}

test("the veil's opacity stays 1 while it darkens and clears", async ({ page }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  const intake = page.getByRole("button", { name: /^Intake/ });
  await expect(intake).toBeVisible();
  // Every frame, the veil's opacity and colour, from before the tap to after it is gone.
  await page.evaluate(() => {
    const w = window as unknown as {
      veil: { opacity: string; colour: string }[];
      sampling: boolean;
    };
    w.veil = [];
    w.sampling = true;
    const tick = () => {
      const el = document.querySelector("[data-sheet-overlay]");
      if (el) {
        const style = getComputedStyle(el);
        w.veil.push({ opacity: style.opacity, colour: style.backgroundColor });
      }
      if (w.sampling) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await intake.click();
  const sheet = page.getByRole("dialog", { name: "Intake" });
  await expect(sheet).toBeVisible();
  await settled(page);
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toBeHidden();
  const samples = await page.evaluate(() => {
    const w = window as unknown as {
      veil: { opacity: string; colour: string }[];
      sampling: boolean;
    };
    w.sampling = false;
    return w.veil;
  });
  const scrim = alphaOf(
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.backgroundColor = "var(--scrim)";
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    }),
  );
  expect(scrim).toBeGreaterThan(0.3);
  expect(samples.length).toBeGreaterThan(20);
  expect(samples.filter((s) => s.opacity !== "1")).toEqual([]);
  const alphas = samples.map((s) => alphaOf(s.colour));
  const peak = alphas.indexOf(Math.max(...alphas));
  expect(alphas[peak]).toBeCloseTo(scrim, 2);
  expect(alphas[0]).toBeLessThan(scrim * 0.2);
  expect(alphas.at(-1)).toBeLessThan(scrim * 0.2);
  // It darkens on the way in and clears on the way out, never stepping back.
  for (let i = 1; i <= peak; i++) expect(alphas[i]).toBeGreaterThanOrEqual(alphas[i - 1]! - 0.001);
  const last = alphas.lastIndexOf(alphas[peak]!);
  for (let i = last + 1; i < alphas.length; i++)
    expect(alphas[i]).toBeLessThanOrEqual(alphas[i - 1]! + 0.001);
});

test("a second tap on Save while the sheet leaves writes nothing, and Undo brings back the first value", async ({
  page,
}) => {
  // The weigh-in is today's: no timing is read in this test.
  await page.clock.setFixedTime(new Date("2026-10-07T08:00:00+02:00"));
  await fakeServer(page, { rows: [...WEEKS, { date: "2026-10-07", weightKg: 81.2 }] });
  await page.goto("/");
  const line = page.getByRole("button", { name: /^Weigh-in/ });
  await expect(line).toContainText("81.2 kg");
  await line.click();
  const sheet = page.getByRole("dialog", { name: "Weigh-in" });
  await sheet.getByRole("textbox", { name: "Weight" }).fill("80.5");
  // Saves, then taps the same spot as soon as the card turns closed, through the page's own hit
  // test, the way a finger lands during the exit.
  const hitSave = await page.evaluate(async () => {
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    const save = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
    const box = save.getBoundingClientRect();
    const turned = new Promise<void>((resolve) =>
      new MutationObserver((_, observer) => {
        observer.disconnect();
        resolve();
      }).observe(dialog, { attributeFilter: ["data-state"] }),
    );
    save.click();
    await turned;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const button = hit?.closest("button");
    button?.click();
    return button === save;
  });
  expect(hitSave).toBe(false);
  await expect(sheet).toBeHidden();
  await expect(line).toContainText("80.5 kg");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(line).toContainText("81.2 kg");
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a sheet is a 480 px centred dialog without a handle that scales in over 220 ms and fades out in 140 ms", async ({
    page,
  }) => {
    const sheet = await openIntake(page);
    const entered = await played(page);
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBe(480);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);
    await expect(sheet.locator("> div[aria-hidden]").first()).toBeHidden();
    expect(entered).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          on: "card",
          name: "dialog-in",
          duration: 220,
          easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        }),
      ]),
    );
    const { animations } = await closeAndRead(page);
    expect(animations).toEqual(
      expect.arrayContaining([
        { name: "fade-out", duration: 140, easing: "cubic-bezier(0.4, 0, 1, 1)", card: true },
      ]),
    );
    await expect(sheet).toBeHidden();
  });
});

test.describe("in French on a 360 px phone", () => {
  test.use({ locale: "fr-FR", viewport: { width: 360, height: 780 } });

  test("Nouvelle annotation and its date chip share the header without overflow", async ({
    page,
  }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/body");
    await page.getByRole("button", { name: /^Annotation\b/ }).click();
    const sheet = page.getByRole("dialog", { name: "Nouvelle annotation" });
    await sheet.getByLabel(/^Date de l.annotation$/).fill("2026-09-30");
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const title = (await sheet
      .getByRole("heading", { name: "Nouvelle annotation" })
      .boundingBox())!;
    const chip = (await sheet.getByText(/mer\.\s30\ssept\./i).boundingBox())!;
    const close = (await sheet.getByRole("button", { name: "Fermer" }).boundingBox())!;
    const card = (await sheet.boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(chip.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(close.x);
    expect(close.x + close.width).toBeLessThanOrEqual(card.x + card.width);
    expect(Math.abs(title.y + title.height / 2 - (close.y + close.height / 2))).toBeLessThan(4);
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(card.x).toBe(8);
    expect(card.width).toBe(344);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});

// A finger on the card: down near its top, a move every 50 ms (slow enough to never be a flick),
// then up. Real touches, so the card's touch-action decides what the browser keeps for itself.
async function swipeDown(page: Page, dy: number, from = 24) {
  const box = (await page.getByRole("dialog").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + from;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: at === undefined ? [] : [{ x, y: at }],
    });
  await touch("touchStart", y);
  for (let i = 1; i <= 8; i++) {
    await touch("touchMove", y + (dy * i) / 8);
    await page.waitForTimeout(50);
  }
  await touch("touchEnd");
  await cdp.detach();
}

const settled = (page: Page) =>
  page.getByRole("dialog").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

// Records the card's running exit as soon as it turns closed.
const watchExit = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { exit: Promise<{ name: string; from: string }[]> };
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    w.exit = new Promise((resolve) =>
      new MutationObserver((_, observer) => {
        observer.disconnect();
        resolve(
          dialog
            .getAnimations()
            .filter((a): a is CSSAnimation => a instanceof CSSAnimation)
            .map((a) => ({
              name: a.animationName,
              from: String((a.effect as KeyframeEffect).getKeyframes()[0]?.transform ?? ""),
            })),
        );
      }).observe(dialog, { attributeFilter: ["data-state"] }),
    );
  });
const exitOf = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { exit: Promise<{ name: string; from: string }[]> }).exit,
  );

test("a swipe past 90 px closes the sheet, a short one snaps back", async ({ page }) => {
  const sheet = await openIntake(page);
  await settled(page);
  await swipeDown(page, 40);
  await expect(sheet).toBeVisible();
  await settled(page);
  await expect
    .poll(() => sheet.evaluate((el) => getComputedStyle(el).transform))
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await watchExit(page);
  await swipeDown(page, 120);
  expect(await exitOf(page)).toEqual([{ name: "sheet-out", from: "translateY(120px)" }]);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /^Intake/ })).toBeFocused();
});

test("pulling the card down lightens the veil by its colour", async ({ page }) => {
  const sheet = await openIntake(page);
  await settled(page);
  const box = (await sheet.boundingBox())!;
  const veil = page.locator("[data-sheet-overlay]");
  const opacity = () => veil.evaluate((el) => getComputedStyle(el).opacity);
  const alpha = async () =>
    alphaOf(await veil.evaluate((el) => getComputedStyle(el).backgroundColor));
  const scrim = await alpha();
  expect(scrim).toBeGreaterThan(0.3);
  const x = box.x + box.width / 2;
  const y = box.y + 24;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", at?: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: at === undefined ? [] : [{ x, y: at }],
    });
  await touch("touchStart", y);
  for (let i = 1; i <= 5; i++) {
    await touch("touchMove", y + 20 * i);
    await page.waitForTimeout(50);
  }
  expect(Math.abs((await alpha()) - scrim * (1 - 100 / box.height))).toBeLessThanOrEqual(0.03);
  expect(await opacity()).toBe("1");
  // Back up short of the threshold, then a slow release: the card and the veil come back.
  for (let i = 1; i <= 3; i++) {
    await touch("touchMove", y + 100 - 20 * i);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(150);
  await touch("touchEnd");
  await cdp.detach();
  await expect(sheet).toBeVisible();
  await expect.poll(alpha).toBeCloseTo(scrim, 3);
  expect(await opacity()).toBe("1");
});

test.describe("on a short phone", () => {
  test.use({ viewport: { width: 390, height: 240 } });

  test("a swipe on a scrolled sheet scrolls it", async ({ page }) => {
    const sheet = await openIntake(page);
    await settled(page);
    const bottom = await sheet.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return el.scrollTop;
    });
    expect(bottom).toBeGreaterThan(100);
    await swipeDown(page, 150);
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((el) => el.scrollTop)).toBeLessThan(bottom);
    expect(await sheet.evaluate((el) => el.style.transform)).toBe("");
  });
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion a swipe still closes it, sliding down from the finger", async ({
    page,
  }) => {
    const sheet = await openIntake(page);
    await settled(page);
    await watchExit(page);
    await swipeDown(page, 120);
    expect(await exitOf(page)).toEqual([{ name: "sheet-out", from: "translateY(120px)" }]);
    await expect(sheet).toBeHidden();
  });

  test("with reduced motion the veil darkens and clears in 200 ms on the out curve by its colour", async ({
    page,
  }) => {
    await recordMotion(page);
    const sheet = await openIntake(page);
    await settled(page);
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    const veil = async () =>
      (await readMotion(page))
        .filter((m) => m.target.includes("[data-sheet-overlay]"))
        .map(({ duration, easing, properties, kind }) => ({ duration, easing, properties, kind }));
    const fade = {
      duration: 200,
      easing: OUT,
      properties: ["background-color"],
      kind: "animation",
    };
    await expect.poll(veil).toEqual([fade, fade]);
  });
});

test.describe("on a wide screen", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("the desktop dialog has no swipe", async ({ page }) => {
    const sheet = await openIntake(page);
    await settled(page);
    await swipeDown(page, 150);
    await page.waitForTimeout(500);
    await expect(sheet).toBeVisible();
    expect(await sheet.evaluate((el) => el.style.transform)).toBe("");
  });
});
