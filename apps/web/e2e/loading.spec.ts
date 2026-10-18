import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer, WEEKS } from "./fake-server";
import { readMotion, recordMotion } from "./motion";

// No fake clock here: the router times its pending page with Date.now(), and a clock that stands
// still would keep that page from ever showing.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const BREATHE = "cubic-bezier(0.42, 0, 0.58, 1)";

type Stamps = { tap?: number; mount?: number; unmount?: number; titleTop?: number };

// When the finger leaves the tab, and when the pending page comes and goes after it, on the page's
// own clock; the title's top is read as the pending page mounts. Home shows the same page while
// the account loads, before any tap: that one is not counted.
async function stamp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { stamps: Stamps };
    w.stamps = {};
    document.addEventListener(
      "pointerup",
      (e) => {
        if ((e.target as Element).closest("nav a")) w.stamps.tap = performance.now();
      },
      true,
    );
    new MutationObserver(() => {
      const pending = document.querySelector("[data-pending]");
      if (pending && w.stamps.tap !== undefined && w.stamps.mount === undefined) {
        w.stamps.mount = performance.now();
        const title = pending.querySelector("p[aria-hidden]");
        if (title) w.stamps.titleTop = title.getBoundingClientRect().top;
      }
      if (!pending && w.stamps.mount !== undefined && w.stamps.unmount === undefined)
        w.stamps.unmount = performance.now();
    }).observe(document, { childList: true, subtree: true });
  });
}

const stamps = (page: Page) =>
  page.evaluate(() => (window as unknown as { stamps: Stamps }).stamps);

// A chunk by name, its hash aside ("body" and not "body-map").
const chunk = (name: string) => new RegExp(`/chunk-${name}-[\\w-]{8}\\.js$`);

// Holds the chunk until the returned function is called, or for `ms` when given.
async function hold(page: Page, name: string, ms?: number) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  await page.route(chunk(name), async (route) => {
    await (ms === undefined ? released : new Promise((r) => setTimeout(r, ms)));
    await route.continue();
  });
  return release;
}

// A signed-in Home whose tabs load only when asked: no idle time ever comes.
async function openHome(page: Page) {
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0;
  });
  await stamp(page);
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Intake/ })).toBeVisible();
}

const tab = (page: Page, name: string) =>
  page.getByRole("navigation", { name: "Main" }).getByRole("link", { name });

test.describe("normal motion", () => {
  test.beforeEach(async ({ page }) => {
    await recordMotion(page);
  });

  test("a tab whose code is late shows its title and the mark after 150 ms, then the page", async ({
    page,
  }) => {
    await openHome(page);
    await hold(page, "body", 1600);
    await tab(page, "Body").click();
    const pending = page.locator("[data-pending]");
    await expect(pending).toBeVisible();
    const title = pending.getByText("Body", { exact: true });
    await expect(title).toBeVisible();
    await expect(title).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeAttached();
    await expect(pending.locator(".loader-mark")).toHaveAttribute("aria-hidden", "true");
    // The tab bar already names the page on its way.
    await expect(tab(page, "Body")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-pill]")).toHaveCSS("--tab-i", "2");
    const motion = await readMotion(page);
    expect(motion).toContainEqual(
      expect.objectContaining({ target: "div", kind: "animation", duration: 200, easing: OUT }),
    );
    for (const delay of [0, 600]) {
      expect(motion).toContainEqual(
        expect.objectContaining({
          target: "span[data-hook]",
          kind: "animation",
          duration: 1200,
          delay,
          easing: BREATHE,
          transforms: false,
        }),
      );
    }

    const h1 = page.getByRole("heading", { name: "Body", level: 1 });
    await expect(h1).toBeVisible({ timeout: 5000 });
    await expect(pending).toHaveCount(0);
    const { tap, mount, titleTop } = await stamps(page);
    expect(mount! - tap!).toBeGreaterThanOrEqual(140);
    const top = await h1.evaluate((el) => el.getBoundingClientRect().top);
    expect(Math.abs(titleTop! - top)).toBeLessThanOrEqual(1);
  });

  test("once shown, the pending page stays at least 400 ms", async ({ page }) => {
    await openHome(page);
    await hold(page, "body", 300);
    await tab(page, "Body").click();
    await expect(page.getByRole("heading", { name: "Body", level: 1 })).toBeVisible();
    await expect(page.locator("[data-pending]")).toHaveCount(0);
    const { mount, unmount } = await stamps(page);
    expect(mount, "the pending page showed").toBeDefined();
    expect(unmount! - mount!).toBeGreaterThanOrEqual(390);
  });

  // A finger, not a pointer, and the code held from the tap, so neither a hover nor an earlier
  // fetch can hide the wait. The service worker is kept out: once it controls the page it serves
  // the chunk from its cache, where no route can hold it.
  test.describe("tapped", () => {
    test.use({ serviceWorkers: "block" });

    test("a tab tapped while its code is held shows the pending page at 150 ms for 400 ms, and not once warm", async ({
      page,
    }) => {
      let tapped = 0;
      await page.route(chunk("workouts"), async (route) => {
        while (!tapped) await new Promise((r) => setTimeout(r, 10));
        const response = await route.fetch();
        await new Promise((r) => setTimeout(r, Math.max(0, tapped + 1600 - Date.now())));
        await route.fulfill({ response });
      });
      await openHome(page);
      tapped = Date.now();
      await tab(page, "Sessions").tap();
      const pending = page.locator("[data-pending]");
      await expect(pending.getByText("Sessions", { exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sessions", level: 1 })).toBeVisible({
        timeout: 5000,
      });
      await expect(pending).toHaveCount(0);
      const { tap: at, mount, unmount } = await stamps(page);
      expect(mount! - at!).toBeGreaterThanOrEqual(140);
      expect(mount! - at!).toBeLessThan(600);
      expect(unmount! - mount!).toBeGreaterThanOrEqual(390);

      await tab(page, "Home").tap();
      await expect(page.getByRole("button", { name: /^Intake/ })).toBeVisible();
      await page.evaluate(() => {
        (window as unknown as { stamps: Stamps }).stamps = {};
      });
      await tab(page, "Sessions").tap();
      await expect(page.getByRole("heading", { name: "Sessions", level: 1 })).toBeVisible();
      await page.waitForTimeout(300);
      expect((await stamps(page)).mount).toBeUndefined();
    });
  });

  // Passes before the pending page exists too: it guards against a pending page that would show
  // on every navigation.
  test("a tab whose code is ready never mounts the pending page", async ({ page }) => {
    await openHome(page);
    // A pointer over the tab fetches its code, as a finger landing on it would.
    const loaded = page.waitForResponse((r) => chunk("tools").test(new URL(r.url()).pathname));
    await tab(page, "Tools").hover();
    await loaded;
    await tab(page, "Tools").click();
    await expect(page.getByRole("heading", { name: "Tools", level: 1 })).toBeVisible();
    await page.waitForTimeout(300);
    expect((await stamps(page)).mount).toBeUndefined();
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion the hooks stand still and the timing holds", async ({ page }) => {
    await recordMotion(page);
    await openHome(page);
    await hold(page, "body", 1600);
    await tab(page, "Body").click();
    await expect(page.locator("[data-pending] [data-hook]").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Body", level: 1 })).toBeVisible({
      timeout: 5000,
    });
    const motion = await readMotion(page);
    expect(motion.filter((m) => m.target === "span[data-hook]")).toEqual([]);
    const { tap, mount } = await stamps(page);
    expect(mount! - tap!).toBeGreaterThanOrEqual(140);
  });
});

test.describe("accessibility", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`the pending page has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await openHome(page);
      const release = await hold(page, "body");
      await tab(page, "Body").click();
      await expect(page.locator("[data-pending]")).toBeVisible();
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
      release();
    });
  }
});
