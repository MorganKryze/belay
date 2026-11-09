import { readdirSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer, WEEKS } from "./fake-server";
import { LAST, LAST_A, SCREENS } from "./key-screens";
import { asAndroid } from "./native";

// Large titles and big figures in the bundled display face, everything else in the system face;
// display-face text grows with the text size until it meets its box, then holds.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
});

const DISPLAY = ".display-title, .display-figure, .display-figure-md, .display-figure-lg";
const FACE = '"Archivo Belay"';

const family = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((all) => all.map((el) => getComputedStyle(el).fontFamily));

test.describe("which face", () => {
  test("titles and figures take the display face, the rest the system face", async ({ page }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await expect(page.locator("[data-slot=trend-figure]")).toContainText("kg");
    for (const f of [
      ...(await family(page, "main h1")),
      ...(await family(page, "[data-slot=trend-figure]")),
    ])
      expect(f).toMatch(/^"Archivo Belay"/);
    const system = [
      ...(await family(page, "body")),
      ...(await family(page, "main button")),
      ...(await family(page, "main h2")),
      ...(await family(page, "[data-slot=trend-figure] > span:not(.sr-only)")),
    ];
    expect(system.length).toBeGreaterThan(3);
    // Roboto is named ahead of the generic system-ui: a Linux machine with Roboto reads the
    // face Android does, not whatever its font configuration calls the system face. Chromium on
    // a Mac reports BlinkMacSystemFont as "system-ui".
    for (const f of system)
      expect(f).toMatch(
        /^-apple-system, (BlinkMacSystemFont|"system-ui"), "Segoe UI", Roboto, system-ui, sans-serif$/,
      );
  });

  test("on Linux the system face is Roboto, as on Android", async ({ page }) => {
    test.skip(process.platform !== "linux", "Apple and Windows machines draw their own face");
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    const body = page.locator("main h2").first();
    await expect(body).toBeVisible();
    await settled(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "main h2",
    });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    expect(fonts.map((f) => f.familyName)).toEqual(["Roboto"]);
  });

  test("the summary's figures and title are in the display face, their units are not", async ({
    page,
  }) => {
    await fakeServer(page, { changes: LAST_A });
    await page.goto(`/workout/summary/${LAST}`);
    await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
    for (const f of [...(await family(page, "main h1")), ...(await family(page, "main dd"))])
      expect(f).toMatch(/^"Archivo Belay"/);
    for (const f of await family(page, "main dd > span")) expect(f).not.toMatch(/Archivo/);
  });

  test("counting figures use tabular digits", async ({ page }) => {
    await fakeServer(page, { changes: LAST_A });
    await page.goto(`/workout/summary/${LAST}`);
    await expect(page.locator("main dd").first()).toBeVisible();
    const numeric = await page
      .locator("main dd")
      .evaluateAll((all) => all.map((el) => getComputedStyle(el).fontVariantNumeric));
    expect(numeric.length).toBeGreaterThan(0);
    for (const n of numeric) expect(n).toContain("tabular-nums");
    await page.goto("/tools/bmi");
    await expect(page.locator("main h1").first()).toBeVisible();
    for (const n of await page
      .locator("[data-slot=result-figure]")
      .evaluateAll((all) => all.map((el) => getComputedStyle(el).fontVariantNumeric)))
      expect(n).toContain("tabular-nums");
  });

  test("a character the face lacks is drawn by the system face", async ({ page }) => {
    await fakeServer(page);
    await page.goto("/tools");
    const title = page.locator("main h1").first();
    await expect(title).toBeVisible();
    await settled(page);
    // Greek omega and a check mark: neither is in the cut.
    await title.evaluate((el) => (el.textContent = "Tools Ω ✓"));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { root } = await cdp.send("DOM.getDocument");
    const { nodeId } = await cdp.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: "main h1",
    });
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    const glyphs = fonts.reduce((sum, f) => sum + f.glyphCount, 0);
    expect(fonts.some((f) => f.isCustomFont && /Archivo/.test(f.familyName))).toBe(true);
    expect(fonts.some((f) => !f.isCustomFont)).toBe(true);
    // Every character but the spaces drawn by one face or the other: nothing is left as a box.
    expect(glyphs).toBe("Tools Ω ✓".length);
  });
});

test.describe("what the page loads", () => {
  test("no font comes from another origin, and the face is the bundled one", async ({ page }) => {
    const fonts: string[] = [];
    const elsewhere: string[] = [];
    page.on("request", (r) => {
      const url = new URL(r.url());
      if (r.resourceType() === "font") fonts.push(url.pathname);
      if (!["localhost", "belay.test"].includes(url.hostname) && url.protocol !== "data:")
        elsewhere.push(r.url());
    });
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await expect(page.locator("main h1").first()).toBeVisible();
    await settled(page);
    expect(elsewhere).toEqual([]);
    expect(fonts.length).toBeGreaterThan(0);
    for (const f of fonts) expect(f).toMatch(/^\/assets\/archivo-belay-[\w-]+\.woff2$/);
  });

  test("the build ships the display face and no Inter", () => {
    const assets = readdirSync(new URL("../dist/assets", import.meta.url));
    expect(assets.filter((f) => /inter/i.test(f) && /\.(woff2?|ttf|otf)$/.test(f))).toEqual([]);
    expect(assets.filter((f) => /^archivo-belay-[\w-]+\.woff2$/.test(f))).toHaveLength(1);
  });

  test("a second launch draws its first page in the display face already", async ({ page }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await expect(page.locator("main h1").first()).toBeVisible();
    // The moment the launch screen goes is the moment the page shows.
    await page.addInitScript((face) => {
      const w = window as unknown as { faceAtLaunch?: boolean };
      new MutationObserver((_, observer) => {
        if (!document.body?.classList.contains("launched")) return;
        observer.disconnect();
        w.faceAtLaunch =
          document.fonts.check(`800 16px ${face}`) &&
          [...document.fonts].some(
            (f) => f.family.replaceAll('"', "") === "Archivo Belay" && f.status === "loaded",
          );
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
    }, FACE);
    await page.reload();
    await page.waitForFunction(() => "faceAtLaunch" in window);
    expect(
      await page.evaluate(() => (window as unknown as { faceAtLaunch: boolean }).faceAtLaunch),
    ).toBe(true);
  });
});

// Each display-face element that breaks a rule: a figure on more than one line or wider than its
// box, a title that overflows sideways or may break inside a word, anything shrunk under 40 %.
const misfits = (page: Page) =>
  page.evaluate((selector) => {
    const all = [...document.querySelectorAll<HTMLElement>(selector)].filter(
      (el) => el.getBoundingClientRect().width > 0 && !el.closest("[aria-hidden=true], [inert]"),
    );
    const bad = all
      .filter((el) => {
        const s = getComputedStyle(el);
        const fit = Number(s.getPropertyValue("--fit") || 1);
        const box = el.getBoundingClientRect();
        const wide = el.scrollWidth > el.clientWidth + 1 || box.right > innerWidth + 1;
        if (fit < 0.4 || wide) return true;
        if (el.classList.contains("display-title"))
          return s.overflowWrap !== "normal" || s.wordBreak !== "normal";
        return s.whiteSpace !== "nowrap" || box.height > parseFloat(s.fontSize) * 1.6;
      })
      .map(
        (el) =>
          `${el.className} "${el.textContent!.slice(0, 30)}" ${el.scrollWidth}/${el.clientWidth}`,
      );
    return { count: all.length, bad, sideways: document.documentElement.scrollWidth > innerWidth };
  }, DISPLAY);

const QUIET = ["the session cover", "the weigh-in sheet"];

const SIZES: [string, (page: Page) => Promise<void>][] = [
  ["the Android text size 2.0", (page) => asAndroid(page, { textScale: 2 })],
  [
    "a browser at 200 %",
    async (page) => {
      // The script runs before the parser makes the root, so it sets the size once there is one.
      await page.addInitScript(() => {
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.style.fontSize = "200%";
        });
      });
    },
  ],
];

for (const [size, enlarge] of SIZES)
  for (const [name, open] of SCREENS)
    test(`at 360 px with ${size}, ${name} keeps its display text inside its box`, async ({
      page,
    }) => {
      await enlarge(page);
      await page.setViewportSize({ width: 360, height: 780 });
      await open(page);
      await expect(page.locator(".launch")).toBeHidden();
      await settled(page);
      const { count, bad, sideways } = await misfits(page);
      // The session cover's titles are compact ones, and the sheet makes the page under it inert.
      if (!QUIET.includes(name)) expect(count, "display-face elements").toBeGreaterThan(0);
      expect(bad).toEqual([]);
      expect(sideways, "sideways scroll").toBe(false);
    });

test("a larger text size grows the title until its box, and no further", async ({ context }) => {
  const title = async (textScale: number) => {
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
    await asAndroid(page, { textScale });
    await page.setViewportSize({ width: 360, height: 780 });
    await fakeServer(page);
    await page.goto("/tools");
    await expect(page.locator("main h1").first()).toBeVisible();
    await settled(page);
    return page
      .locator("main h1")
      .first()
      .evaluate((el) => ({
        size: parseFloat(getComputedStyle(el).fontSize),
        fits: el.scrollWidth <= el.clientWidth + 1,
      }));
  };
  const normal = await title(1);
  const large = await title(2);
  expect(large.size).toBeGreaterThan(normal.size);
  expect(large.fits).toBe(true);
});
