import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

test.use({ locale: "en-US" });

type Played = {
  types: string[];
  animations: { target: string; duration: number; easing: string; keyframes: Keyframe[] }[];
};

// Records every page transition the router starts: its types and the animations of its
// snapshots, read as soon as they start.
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { played: Played[] };
    w.played = [];
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((arg: StartViewTransitionOptions) => {
      const transition = start(arg);
      void transition.ready.then(() => {
        w.played.push({
          types: [...transition.types],
          animations: document
            .getAnimations()
            .filter((a) => (a.effect as KeyframeEffect).pseudoElement?.startsWith("::view-"))
            .map((a) => {
              const effect = a.effect as KeyframeEffect;
              const keyframes = effect.getKeyframes();
              return {
                target: effect.pseudoElement!,
                duration: Number(effect.getComputedTiming().duration),
                easing: String(keyframes[0]?.easing),
                keyframes: keyframes.map(({ transform, opacity }) => ({ transform, opacity })),
              };
            }),
        });
      });
      return transition;
    }) as typeof document.startViewTransition;
  });
}

const played = (page: Page) =>
  page.evaluate(() => (window as unknown as { played: Played[] }).played);
const animation = (p: Played, target: string) => p.animations.find((a) => a.target === target);

const NAV = "cubic-bezier(0.32, 0.72, 0, 1)";
const SHEET = "cubic-bezier(0.4, 0.2, 0, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

async function openPlates(page: Page) {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await page.getByRole("link", { name: /^Plates/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Plates" })).toBeVisible();
}

test("a pushed page slides in from the right in 420 ms on the nav curve while the old one moves 25 % left", async ({
  page,
}) => {
  await recordTransitions(page);
  await openPlates(page);
  await expect.poll(async () => (await played(page)).length).toBe(1);
  const [push] = await played(page);
  expect(push!.types).toEqual(["push"]);
  const enter = animation(push!, "::view-transition-new(main)");
  expect(enter).toMatchObject({ duration: 420, easing: NAV });
  expect(enter!.keyframes[0]!.transform).toBe("translate(100%)");
  const leave = animation(push!, "::view-transition-old(main)");
  expect(leave).toMatchObject({ duration: 420, easing: NAV });
  expect(leave!.keyframes.at(-1)).toMatchObject({ transform: "translate(-25%)", opacity: "0.94" });
  // Only the page moves: no group morphs, the root does not slide.
  expect(push!.animations.map((a) => a.target).sort()).toEqual([
    "::view-transition-new(main)",
    "::view-transition-old(main)",
  ]);
});

test("Back plays the reverse in 340 ms", async ({ page }) => {
  await recordTransitions(page);
  await openPlates(page);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await expect.poll(async () => (await played(page)).length).toBe(2);
  const pop = (await played(page))[1]!;
  expect(pop.types).toEqual(["pop"]);
  const enter = animation(pop, "::view-transition-new(main)");
  expect(enter).toMatchObject({ duration: 340, easing: NAV });
  expect(enter!.keyframes[0]).toMatchObject({ transform: "translate(-25%)", opacity: "0.94" });
  const leave = animation(pop, "::view-transition-old(main)");
  expect(leave).toMatchObject({ duration: 340, easing: NAV });
  expect(leave!.keyframes.at(-1)!.transform).toBe("translate(100%)");
});

test("a tab switch runs no page animation", async ({ page }) => {
  await recordTransitions(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Belay" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tools" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Body" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Body" })).toBeVisible();
  expect(await played(page)).toEqual([]);
});

// Two frames: a transition the click started has resolved `ready` by then and been recorded.
const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
  );

test("a tab switch from a pushed page runs no page animation", async ({ page }) => {
  await recordTransitions(page);
  await openPlates(page);
  await expect.poll(async () => (await played(page)).length).toBe(1);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Body" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Body" })).toBeVisible();
  await frames(page);
  expect((await played(page)).map((p) => p.types)).toEqual([["push"]]);
});

test("a top bar section from Réglages runs no page animation", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await recordTransitions(page);
  await page.goto("/settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "Sessions" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
  await frames(page);
  expect(await played(page)).toEqual([]);
});

test("the session rises as a cover in 450 ms and leaves in 260 ms", async ({ page }) => {
  await page.unroute("**/api/me");
  await fakeServer(page);
  await recordTransitions(page);
  await page.goto("/");
  await page.getByRole("link", { name: /^Session [ABC] · / }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Session [ABC] · / })).toBeVisible();
  await expect.poll(async () => (await played(page)).length).toBe(1);
  const cover = (await played(page))[0]!;
  expect(cover.types).toEqual(["cover"]);
  const rise = animation(cover, "::view-transition-new(main)");
  expect(rise).toMatchObject({ duration: 450, easing: SHEET });
  expect(rise!.keyframes[0]!.transform).toBe("translateY(100%)");
  // The dock fades out as the cover takes the screen, and comes back as it leaves.
  expect(animation(cover, "::view-transition-old(dock)")!.keyframes.at(-1)!.opacity).toBe("0");

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  await expect.poll(async () => (await played(page)).length).toBe(2);
  const uncover = (await played(page))[1]!;
  expect(uncover.types).toEqual(["uncover"]);
  const sink = animation(uncover, "::view-transition-old(main)");
  expect(sink).toMatchObject({ duration: 260, easing: EXIT });
  expect(sink!.keyframes.at(-1)!.transform).toBe("translateY(100%)");
  expect(animation(uncover, "::view-transition-new(dock)")!.keyframes[0]!.opacity).toBe("0");
});

test("without View Transitions a navigation lands on the right page at once", async ({ page }) => {
  await page.addInitScript(() => {
    delete (Document.prototype as Partial<Document>).startViewTransition;
  });
  await openPlates(page);
  expect(await page.evaluate(() => "startViewTransition" in document)).toBe(false);
  await expect(page).toHaveURL(/\/tools\/plates$/);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
});

test("a pushed page opens at its top and Back restores the scroll", async ({ page }) => {
  // Short enough that the tools list scrolls well past its first tools.
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/tools");
  const plates = page.getByRole("link", { name: /^Plates/ });
  await expect(plates).toBeVisible();
  const bmi = page.getByRole("link", { name: /^BMI/ });
  await bmi.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(100);
  await bmi.click();
  await expect(page.getByRole("heading", { level: 1, name: "BMI" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test("the back chevron brings the list back where it was", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/tools");
  const bmi = page.getByRole("link", { name: /^BMI/ });
  await bmi.scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(100);
  await bmi.click();
  await expect(page.getByRole("heading", { level: 1, name: "BMI" })).toBeVisible();
  const entries = await page.evaluate(() => history.length);
  await page.locator("main").getByRole("link", { name: "Tools", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled);
  // It went back: no entry stacked on top of the page.
  expect(await page.evaluate(() => history.length)).toBe(entries);
});
