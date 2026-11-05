import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer } from "./fake-server";
import { asAndroid } from "./native";

// Each tab keeps the page and scroll it was left on, and a switch adds no Back step.
test.use({ locale: "fr-FR" });

async function open(page: Page, path: string, changes: Change[] = []) {
  const server = await fakeServer(page, { changes });
  await page.goto(path);
  await expect(page.locator(".launch")).toBeHidden();
  return server;
}

// The dock on a phone, the top bar on a computer: whichever shows.
const tab = (page: Page, name: string) =>
  page.getByRole("link", { name, exact: true }).locator("visible=true");
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
const entries = (page: Page) => page.evaluate(() => history.length);
const exercise = (page: Page) =>
  page
    .locator("main")
    .getByRole("link", { name: /^Barbell bench press/i })
    .first();

async function scrollTo(page: Page, y: number) {
  await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), y);
  await expect.poll(() => scrollY(page)).toBe(y);
}

// Counts the page transitions started from now on.
async function countTransitions(page: Page) {
  await page.evaluate(() => {
    const w = window as typeof window & { transitions: number };
    w.transitions = 0;
    const start = document.startViewTransition?.bind(document);
    if (start)
      document.startViewTransition = ((arg: never) => {
        w.transitions++;
        return start(arg);
      }) as typeof document.startViewTransition;
  });
}
const transitions = (page: Page) =>
  page.evaluate(() => (window as typeof window & { transitions: number }).transitions);

for (const width of [412, 1280]) {
  test.describe(`at ${width} px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
    });

    test("a tab comes back on the page and scroll it was left on, with no transition, focus on its title", async ({
      page,
    }) => {
      await open(page, "/workouts?tab=exercises");
      await exercise(page).click();
      await expect(page).toHaveURL(/\/exercises\//);
      const deep = page.url();
      // The list stays on screen until the page is ready: scroll the page, not the list.
      await expect(
        page.getByRole("heading", { level: 1, name: /^Barbell bench press/i }),
      ).toBeVisible();
      await settled(page);
      const max = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      const y = Math.min(150, Math.floor(max));
      await scrollTo(page, y);
      await countTransitions(page);
      await tab(page, "Corps").click();
      await expect(page.getByRole("heading", { level: 1, name: "Corps" })).toBeVisible();
      await tab(page, "Séances").click();
      await expect(page).toHaveURL(deep);
      await expect(page.locator("main h1")).toBeFocused();
      await expect.poll(() => scrollY(page)).toBeGreaterThanOrEqual(y - 2);
      expect(Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(2);
      expect(await transitions(page)).toBe(0);
    });

    test("a tab root comes back where it was scrolled", async ({ page }) => {
      await open(page, "/workouts?tab=exercises");
      await expect(exercise(page)).toBeVisible();
      await scrollTo(page, 900);
      await tab(page, "Outils").click();
      await expect(page.getByRole("heading", { level: 1, name: "Outils" })).toBeVisible();
      await tab(page, "Séances").click();
      await expect(page).toHaveURL(/\/workouts\?tab=exercises$/);
      await expect(page.locator("main h1")).toBeFocused();
      await expect.poll(() => scrollY(page)).toBe(900);
    });

    test("five switches add no Back step", async ({ page }) => {
      await open(page, "/");
      const length = await entries(page);
      for (const name of ["Séances", "Corps", "Outils", "Accueil", "Corps"]) {
        await tab(page, name).click();
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      }
      await expect(page).toHaveURL(/\/body$/);
      expect(await entries(page)).toBe(length);
    });

    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      test(`the active tab goes to its root, then to the top, motion ${reducedMotion}`, async ({
        page,
      }) => {
        await page.emulateMedia({ reducedMotion });
        await open(page, "/workouts?tab=exercises");
        await exercise(page).click();
        await expect(page).toHaveURL(/\/exercises\//);
        await tab(page, "Séances").click();
        await expect(page).toHaveURL(/\/workouts\?tab=exercises$/);
        await expect(exercise(page)).toBeVisible();
        await scrollTo(page, 900);
        // The router may still be putting the list back where it was when the tap lands, so the
        // scroll is read from the call that sends the page up, not from a frame of it.
        await page.evaluate(() => {
          const w = window as typeof window & { ups: unknown[] };
          w.ups = [];
          const scroll = window.scrollTo.bind(window);
          window.scrollTo = ((...args: [ScrollToOptions]) => {
            if (typeof args[0] === "object" && args[0].top === 0) w.ups.push(args[0].behavior);
            return scroll(...args);
          }) as typeof window.scrollTo;
        });
        await tab(page, "Séances").click();
        await expect
          .poll(() => page.evaluate(() => (window as typeof window & { ups: unknown[] }).ups))
          .toEqual([reducedMotion === "reduce" ? "auto" : "smooth"]);
        await expect.poll(() => scrollY(page)).toBe(0);
        await expect(page).toHaveURL(/\/workouts\?tab=exercises$/);
      });
    }
  });
}

test.describe("in the Android app", () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await asAndroid(page, { instance: baseURL!, token: "a".repeat(43) });
  });

  async function restored(page: Page) {
    await open(page, "/workouts?tab=exercises");
    await exercise(page).click();
    await expect(page).toHaveURL(/\/exercises\//);
    const deep = page.url();
    await tab(page, "Corps").click();
    await expect(page.getByRole("heading", { level: 1, name: "Corps" })).toBeVisible();
    const length = await entries(page);
    await tab(page, "Séances").click();
    await expect(page).toHaveURL(deep);
    // The tab's root now sits under the page: one entry more, and only that.
    expect(await entries(page)).toBe(length + 1);
    return length;
  }

  test("Back from a restored page shows the tab's root in one step", async ({ page }) => {
    await restored(page);
    await expect.poll(() => page.evaluate(() => typeof window.belayBack)).toBe("function");
    expect(await page.evaluate(() => window.belayBack?.())).toBe("page");
    await expect(page).toHaveURL(/\/workouts\?tab=exercises$/);
    await expect(page.getByRole("heading", { level: 1, name: "Séances" })).toBeVisible();
  });

  test("the chevron of a restored page shows the tab's root in one step", async ({ page }) => {
    const length = await restored(page);
    const index = () => page.evaluate(() => (history.state as { __TSR_index: number }).__TSR_index);
    const deep = await index();
    await page.locator("main").getByRole("link", { name: "Exercices", exact: true }).click();
    await expect(page).toHaveURL(/\/workouts\?tab=exercises$/);
    await expect(page.getByRole("heading", { level: 1, name: "Séances" })).toBeVisible();
    // Gone back, not opened again on top.
    expect(await entries(page)).toBe(length + 1);
    expect(await index()).toBe(deep - 1);
  });
});

const WORKOUT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01";
const startedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
const endedAt = new Date(Date.parse(startedAt) + 3_600_000).toISOString();
const FINISHED: Change[] = [
  {
    kind: "workout",
    id: WORKOUT,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt,
    at: startedAt,
  },
  { kind: "workout", id: WORKOUT, field: "ended", value: endedAt, at: endedAt },
];

test("a remembered session removed meanwhile gives way to the tab's root", async ({ page }) => {
  const server = await open(page, `/workouts/${WORKOUT}`, FINISHED);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await tab(page, "Corps").click();
  await expect(page.getByRole("heading", { level: 1, name: "Corps" })).toBeVisible();
  const asked = server.requests.length;
  const at = new Date().toISOString();
  server.push({ kind: "workout", id: WORKOUT, field: "removed", value: true, at });
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(() => server.requests.length).toBeGreaterThan(asked);
  await tab(page, "Séances").click();
  await expect(page).toHaveURL(/\/workouts$/);
  await expect(page.getByRole("heading", { level: 1, name: "Séances" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeHidden();
});

test.describe("with no service worker, so the chunk's request reaches the test", () => {
  test.use({ serviceWorkers: "block" });

  test("a remembered page whose code fails to load gives way to the tab's root", async ({
    page,
  }) => {
    // The exercise page's own chunk, not the loop or the picker that share its name.
    await page.route(/\/chunk-exercise-[\w-]{8}\.js$/, (route) => route.abort());
    await open(page, "/workouts?tab=exercises");
    await exercise(page).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await tab(page, "Corps").click();
    await expect(page.getByRole("heading", { level: 1, name: "Corps" })).toBeVisible();
    await tab(page, "Séances").click();
    await expect(page).toHaveURL(/\/workouts$/);
    await expect(page.getByRole("heading", { level: 1, name: "Séances" })).toBeVisible();
    await expect(page.getByRole("alert")).toBeHidden();
  });
});

test("a reload forgets every tab's page", async ({ page }) => {
  await open(page, "/tools");
  await page.locator("main").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/tools\/.+/);
  await tab(page, "Corps").click();
  await expect(page).toHaveURL(/\/body$/);
  await page.reload();
  await expect(page.locator(".launch")).toBeHidden();
  await tab(page, "Outils").click();
  await expect(page).toHaveURL(/\/tools$/);
});

test("signing out forgets every tab's page", async ({ page }) => {
  await open(page, "/tools");
  await page.route("**/auth/logout", (route) =>
    route.fulfill({ json: { redirectTo: "/" }, status: 200 }),
  );
  await page.locator("main").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/tools\/.+/);
  await tab(page, "Accueil").click();
  await page.getByRole("link", { name: "Réglages" }).click();
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /^Se déconnecter/ })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator(".launch")).toBeHidden();
  await tab(page, "Outils").click();
  await expect(page).toHaveURL(/\/tools$/);
});

test.describe("on a computer", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test("Réglages is remembered by no tab, and a tab from there is a new entry", async ({
    page,
  }) => {
    await open(page, "/");
    await page.getByRole("link", { name: "Réglages" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    const length = await entries(page);
    await tab(page, "Corps").click();
    await expect(page).toHaveURL(/\/body$/);
    expect(await entries(page)).toBe(length + 1);
    for (const [name, url] of [
      ["Accueil", /\/$/],
      ["Séances", /\/workouts$/],
      ["Outils", /\/tools$/],
      ["Corps", /\/body$/],
    ] as const) {
      await tab(page, name).click();
      await expect(page).toHaveURL(url);
    }
  });
});

test("the session cover is remembered by no tab", async ({ page }) => {
  await open(page, "/workout?start=A");
  await page.getByRole("button", { name: "Réduire la séance" }).click();
  await expect(page).toHaveURL(/\/$/);
  await tab(page, "Séances").click();
  await expect(page).toHaveURL(/\/workouts$/);
  await tab(page, "Accueil").click();
  await expect(page).toHaveURL(/\/$/);
});
