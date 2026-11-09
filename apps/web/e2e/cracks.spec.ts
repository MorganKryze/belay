import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer, WEEKS } from "./fake-server";
import { LAST, LAST_A, RUNNING_A, SCREENS, sessionBar } from "./key-screens";
import { asAndroid, setContrast } from "./native";

// A few fine cracks fixed in the top-right corner, behind the page, never under text, and none
// where the person asked for plainer grounds.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
});

type Box = { left: number; top: number; width: number; height: number };

// The layer's box on screen, or null when it draws nothing.
const layer = (page: Page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.documentElement, "::before");
    if (s.content === "none" || s.display === "none" || !/cracks-/.test(s.backgroundImage))
      return null;
    if (s.position !== "fixed") return { fixed: false, left: 0, top: 0, width: 0, height: 0 };
    const width = parseFloat(s.width);
    return {
      fixed: true,
      left: innerWidth - parseFloat(s.right) - width,
      top: parseFloat(s.top),
      width,
      height: parseFloat(s.height),
    };
  });

const glassIsSolid = (page: Page) =>
  page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return s.getPropertyValue("--glass").trim() === s.getPropertyValue("--surface").trim();
  });

// How many pixels inside each box change when the layer is hidden: two captures of the same still
// page, one with the drawing and one without.
async function changed(page: Page, boxes: Box[]): Promise<number[]> {
  const shot = async () =>
    (await page.screenshot({ scale: "css", animations: "disabled", caret: "hide" })).toString(
      "base64",
    );
  // The drawing is fetched on first use: both captures wait until it is ready to paint.
  await page.evaluate(async () => {
    const image = getComputedStyle(document.documentElement, "::before").backgroundImage;
    const url = /url\("?([^")]+)"?\)/.exec(image)?.[1];
    if (url) {
      const drawing = new Image();
      drawing.src = url;
      await drawing.decode();
      await new Promise((frame) => requestAnimationFrame(() => requestAnimationFrame(frame)));
    }
  });
  const on = await shot();
  await page.evaluate(() => document.documentElement.style.setProperty("--cracks", "none"));
  const off = await shot();
  await page.evaluate(() => document.documentElement.style.removeProperty("--cracks"));
  return page.evaluate(
    async ({ on, off, boxes }) => {
      const pixels = async (png: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const [a, b] = [await pixels(on), await pixels(off)];
      return boxes.map((box) => {
        let count = 0;
        for (
          let y = Math.max(0, Math.floor(box.top));
          y < Math.min(a.height, box.top + box.height);
          y++
        )
          for (
            let x = Math.max(0, Math.floor(box.left));
            x < Math.min(a.width, box.left + box.width);
            x++
          ) {
            const i = (y * a.width + x) * 4;
            if (
              a.data[i] !== b.data[i] ||
              a.data[i + 1] !== b.data[i + 1] ||
              a.data[i + 2] !== b.data[i + 2]
            )
              count++;
          }
        return count;
      });
    },
    { on, off, boxes },
  );
}

// The box of every line of visible text on screen, cut to the layer's box.
const textBoxes = (page: Page, within: Box) =>
  page.evaluate((within) => {
    const boxes: { left: number; top: number; width: number; height: number; text: string }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent!.trim();
      const parent = node.parentElement!;
      // A visually hidden label is clipped to a pixel box and draws nothing.
      const own = parent.getBoundingClientRect();
      if (
        !text ||
        own.width <= 1 ||
        own.height <= 1 ||
        !parent.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      )
        continue;
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        const left = Math.max(r.left, within.left);
        const top = Math.max(r.top, within.top);
        const right = Math.min(r.right, within.left + within.width, innerWidth);
        const bottom = Math.min(r.bottom, within.top + within.height, innerHeight);
        if (right > left && bottom > top)
          boxes.push({ left, top, width: right - left, height: bottom - top, text });
      }
    }
    return boxes;
  }, within);

const WIDTHS = [
  [360, 780],
  [390, 844],
  [1280, 800],
] as const;

test.describe("where the layer sits", () => {
  for (const [width, height] of [WIDTHS[1], WIDTHS[2]])
    for (const scheme of ["light", "dark"] as const)
      test(`at ${width} px in ${scheme}, the cracks show in the top-right corner`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height });
        await fakeServer(page, { rows: WEEKS });
        await page.goto("/");
        await expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();
        await settled(page);
        const box = await layer(page);
        const wide = width >= 1024;
        expect(box).toEqual({
          fixed: true,
          left: width - (wide ? 400 : 240),
          top: wide ? 64 : 0,
          width: wide ? 400 : 240,
          height: wide ? 933 : 560,
        });
        expect(
          await page.evaluate(
            () => getComputedStyle(document.documentElement, "::before").backgroundImage,
          ),
        ).toContain(`cracks-${scheme}`);
        // Some of the drawing is seen: the page does not cover all of it.
        expect((await changed(page, [box!]))[0]).toBeGreaterThan(50);
      });

  for (const scheme of ["light", "dark"] as const)
    test(`at 390 px in ${scheme} and the default text, cracks and the mark fill the corner above the first card`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();
      await settled(page);
      const box = (await layer(page))!;
      // The top of what follows the page's header, and where the mark sits in the drawing.
      const { cardTop, at } = await page.evaluate(async () => {
        // The page's header is the first block of the page's section; the first card follows it.
        let header: Element = document.querySelector("main h1")!;
        const section = header.closest("section")!;
        while (header.parentElement !== section) header = header.parentElement!;
        let next = header.nextElementSibling;
        while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
        const image = getComputedStyle(document.documentElement, "::before").backgroundImage;
        const svg = await (await fetch(/url\("?([^")]+)"?\)/.exec(image)![1]!)).text();
        const [, x, y] =
          /<g opacity="[\d.]+"[^>]* transform="translate\(([\d.-]+) ([\d.-]+)\)/.exec(svg)!;
        return { cardTop: next!.getBoundingClientRect().top, at: [Number(x), Number(y)] };
      });
      const corner = { left: box.left, top: 0, width: box.width, height: cardTop };
      // The mark is 12 px wide and 11 px tall.
      const mark = { left: box.left + at[0]!, top: box.top + at[1]!, width: 12, height: 11 };
      expect(mark.top + mark.height).toBeLessThan(cardTop);
      const [inCorner, onMark] = await changed(page, [corner, mark]);
      expect(inCorner).toBeGreaterThan(100);
      expect(onMark).toBeGreaterThan(10);
    });

  test("the drawing moves down with larger text and below a phone page's own corner text", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await asAndroid(page, { textScale: 1.5 });
    await fakeServer(page, { rows: WEEKS, changes: LAST_A });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();
    // Halfway to twice the size, halfway down; the bottom stays where it was.
    expect(await layer(page)).toMatchObject({ top: 75, height: 485 });
    await page.goto(`/workout/summary/${LAST}`);
    await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
    expect(await layer(page)).toMatchObject({ top: 150, height: 410 });
    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await layer(page)).toMatchObject({ top: 64 + 75 * (5 / 3), height: 933 - 75 * (5 / 3) });
  });

  test("the layer holds still on a scroll, a push, a pop and the session cover rising", async ({
    page,
  }) => {
    // Short enough for Home to scroll, with a session running for the cover.
    await page.setViewportSize({ width: 390, height: 600 });
    await fakeServer(page, { changes: RUNNING_A });
    await page.goto("/");
    await expect(sessionBar(page)).toBeVisible();
    await settled(page);
    const still = await layer(page);
    expect(still?.fixed).toBe(true);
    await page.evaluate(() => scrollTo(0, 400));
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await layer(page)).toEqual(still);
    await page.getByRole("link", { name: "Tools" }).click();
    await settled(page);
    await page.locator('main a[href="/tools/bmi"]').click();
    await expect(page.getByRole("heading", { level: 1, name: "BMI" })).toBeVisible();
    await settled(page);
    expect(await layer(page)).toEqual(still);
    await page.goBack();
    await settled(page);
    expect(await layer(page)).toEqual(still);
    await sessionBar(page).click();
    await expect(page.getByRole("button", { name: "Minimize the session" })).toBeVisible();
    await settled(page);
    expect(await layer(page)).toEqual(still);
  });
});

test.describe("plainer grounds", () => {
  test("no cracks and solid bars with more contrast", async ({ page }) => {
    await page.emulateMedia({ contrast: "more" });
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await layer(page)).toBeNull();
    expect(await glassIsSolid(page)).toBe(true);
  });

  test("no cracks and solid bars with forced colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await layer(page)).toBeNull();
    expect(await glassIsSolid(page)).toBe(true);
  });

  test("the cracks show, the bars frosted, by default", async ({ page }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await layer(page)).not.toBeNull();
    expect(await glassIsSolid(page)).toBe(false);
  });

  test("in the Android app, more contrast reported by the shell holds from the first paint", async ({
    page,
  }) => {
    // What the root carries when the body starts, before anything is drawn.
    await page.addInitScript(() => {
      new MutationObserver((_, observer) => {
        if (!document.body) return;
        observer.disconnect();
        sessionStorage.setItem(
          "contrastAtBody",
          document.documentElement.dataset.contrast ?? "none",
        );
      }).observe(document, { childList: true, subtree: true });
    });
    await asAndroid(page, { contrast: true });
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("contrastAtBody"))).toBe("more");
    expect(await layer(page)).toBeNull();
    expect(await glassIsSolid(page)).toBe(true);
  });

  test("in the Android app, a contrast change shows when the app comes back", async ({ page }) => {
    await asAndroid(page, { contrast: false });
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    expect(await layer(page)).not.toBeNull();
    const comeBack = () =>
      page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await setContrast(page, true);
    await comeBack();
    await expect.poll(() => layer(page)).toBeNull();
    expect(await glassIsSolid(page)).toBe(true);
    await setContrast(page, false);
    await comeBack();
    await expect.poll(() => layer(page)).not.toBeNull();
  });
});

const SCROLL_STEP = 40;
const SIZES = [
  ["the default text", async () => {}],
  // Between the two the drawing is part of the way down: one size on the way checks the slope.
  ["a larger text", (page: Page) => asAndroid(page, { textScale: 1.4 })],
  ["the largest text", (page: Page) => asAndroid(page, { textScale: 2 })],
] as const;

for (const [width, height] of WIDTHS)
  for (const scheme of ["light", "dark"] as const)
    for (const [size, enlarge] of SIZES)
      for (const [name, open] of SCREENS)
        test(`no crack under text: ${name} at ${width} px, ${scheme}, ${size}`, async ({
          page,
        }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width, height });
          await enlarge(page);
          await open(page);
          await expect(page.locator(".launch")).toBeHidden();
          await settled(page);
          const box = await layer(page);
          expect(box).not.toBeNull();
          // The page scrolls over the still layer, so every line is read at each step from the
          // top to the bottom. A step is about two lines of text: a crack runs down the edge
          // further than that, so a line that would cross one meets it at some step.
          const end = await page.evaluate(
            () => document.documentElement.scrollHeight - innerHeight,
          );
          for (let y = 0; ; y = Math.min(y + SCROLL_STEP, end)) {
            await page.evaluate((top) => scrollTo({ top, behavior: "instant" }), y);
            // Read until two still captures agree: a screen still settling its data changes
            // between them, a crack under text stays.
            await expect
              .poll(
                async () => {
                  const boxes = await textBoxes(page, box!);
                  const counts = await changed(page, boxes);
                  return boxes
                    .filter((_, i) => counts[i]! > 0)
                    .map((b) => `${b.text} at ${Math.round(b.left)},${Math.round(b.top)}`);
                },
                { timeout: 10_000, message: `scrolled ${y} px` },
              )
              .toEqual([]);
            if (y >= end) break;
          }
        });

test("offline after one visit, the cracks still load", async ({ page, context }) => {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator("main h1").first()).toBeVisible();
  const loaded = await page.evaluate(async () => {
    const image = getComputedStyle(document.documentElement, "::before").backgroundImage;
    const url = /url\("?([^")]+)"?\)/.exec(image)![1]!;
    const response = await fetch(url);
    return { url, ok: response.ok, type: response.headers.get("content-type") };
  });
  expect(loaded.url).toMatch(/\/assets\/cracks-light-[\w-]+\.svg$/);
  expect(loaded.ok).toBe(true);
  expect(loaded.type).toContain("svg");
});
