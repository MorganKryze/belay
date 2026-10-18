import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

test.use({ locale: "en-US" });

type Played = {
  types: string[];
  animations: { target: string; duration: number; easing: string; keyframes: Keyframe[] }[];
  // Where the leaving page's top was on screen just before the change, how far the page was
  // scrolled, and where its moving snapshot draws that top once the transition is ready.
  page: { scrollY: number; top: number; drawn: number };
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
      const scrollY = window.scrollY;
      const main = document.querySelector("main")!;
      const top = main.getBoundingClientRect().top;
      // The snapshot that carries the page: the nearest named box around main, else the root,
      // whose snapshot is the viewport. Its on-screen top as it is captured.
      let name = "root";
      let origin = 0;
      for (
        let el: Element | null = main;
        el && el !== document.documentElement;
        el = el.parentElement
      ) {
        const named = getComputedStyle(el).viewTransitionName;
        if (named !== "none") {
          name = named;
          origin = el.getBoundingClientRect().top;
          break;
        }
      }
      const transition = start(arg);
      void transition.ready.then(() => {
        const at = getComputedStyle(
          document.documentElement,
          `::view-transition-group(${name})`,
        ).transform;
        const drawn = (at === "none" ? 0 : new DOMMatrix(at).f) + (top - origin);
        w.played.push({
          page: { scrollY, top, drawn },
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
const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const SHEET = "cubic-bezier(0.4, 0.2, 0, 1)";
const EXIT = "cubic-bezier(0.4, 0, 1, 1)";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
});

// Accueil's session row opens the preview, whose Start raises the session.
async function startFromHome(page: Page) {
  await page.getByRole("link", { name: /^Session [ABC] · / }).click();
  await page.getByRole("link", { name: "Start the session" }).click();
  await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
}

async function openPlates(page: Page) {
  await page.goto("/tools");
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await page.getByRole("link", { name: /^Plates/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Plates" })).toBeVisible();
}

for (const [scheme, dim] of [
  ["dark", "0.8"],
  ["light", "0.9"],
] as const) {
  test(`a pushed page slides in from the right in 420 ms on the nav curve while the old one moves 25 % left and dims to ${Number(dim) * 100} % in ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await recordTransitions(page);
    await openPlates(page);
    await expect.poll(async () => (await played(page)).length).toBe(1);
    const [push] = await played(page);
    expect(push!.types).toEqual(["push"]);
    const enter = animation(push!, "::view-transition-new(root)");
    expect(enter).toMatchObject({ duration: 420, easing: NAV });
    expect(enter!.keyframes[0]!.transform).toBe("translate(100%)");
    const leave = animation(push!, "::view-transition-old(root)");
    expect(leave).toMatchObject({ duration: 420, easing: NAV });
    expect(leave!.keyframes.at(-1)).toMatchObject({ transform: "translate(-25%)", opacity: dim });
    // Only the page moves, as the root snapshot: no group morphs, the dock and top bar hold still.
    expect(push!.animations.map((a) => a.target).sort()).toEqual([
      "::view-transition-new(root)",
      "::view-transition-old(root)",
    ]);
  });
}

test("Back plays the reverse in 380 ms", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await recordTransitions(page);
  await openPlates(page);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  await expect.poll(async () => (await played(page)).length).toBe(2);
  const pop = (await played(page))[1]!;
  expect(pop.types).toEqual(["pop"]);
  const enter = animation(pop, "::view-transition-new(root)");
  expect(enter).toMatchObject({ duration: 380, easing: NAV });
  expect(enter!.keyframes[0]).toMatchObject({ transform: "translate(-25%)", opacity: "0.8" });
  const leave = animation(pop, "::view-transition-old(root)");
  expect(leave).toMatchObject({ duration: 380, easing: NAV });
  expect(leave!.keyframes.at(-1)!.transform).toBe("translate(100%)");
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("with reduced motion a pushed page slides in over a still page in 300 ms on the out curve, and Back slides it out over a still page", async ({
    page,
  }) => {
    await recordTransitions(page);
    await openPlates(page);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
    await expect.poll(async () => (await played(page)).length).toBe(2);
    const [push, pop] = await played(page);
    expect(push!.types).toEqual(["push"]);
    const enter = animation(push!, "::view-transition-new(root)");
    expect(enter).toMatchObject({ duration: 300, easing: OUT });
    expect(enter!.keyframes[0]!.transform).toBe("translate(100%)");
    expect(animation(push!, "::view-transition-old(root)")).toBeUndefined();
    expect(pop!.types).toEqual(["pop"]);
    const leave = animation(pop!, "::view-transition-old(root)");
    expect(leave).toMatchObject({ duration: 300, easing: OUT });
    expect(leave!.keyframes.at(-1)!.transform).toBe("translate(100%)");
    expect(animation(pop!, "::view-transition-new(root)")).toBeUndefined();
  });

  test("with reduced motion the session cover rises and sinks in 300 ms on the out curve", async ({
    page,
  }) => {
    await page.unroute("**/api/me");
    await fakeServer(page);
    await recordTransitions(page);
    await page.goto("/");
    await startFromHome(page);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
    await expect.poll(async () => (await played(page)).length).toBe(3);
    const [, cover, uncover] = await played(page);
    expect(cover!.types).toEqual(["cover"]);
    const rise = animation(cover!, "::view-transition-new(root)");
    expect(rise).toMatchObject({ duration: 300, easing: OUT });
    expect(rise!.keyframes[0]!.transform).toBe("translateY(100%)");
    expect(animation(cover!, "::view-transition-old(root)")).toBeUndefined();
    expect(uncover!.types).toEqual(["uncover"]);
    const sink = animation(uncover!, "::view-transition-old(root)");
    expect(sink).toMatchObject({ duration: 300, easing: OUT });
    expect(sink!.keyframes.at(-1)!.transform).toBe("translateY(100%)");
    expect(animation(uncover!, "::view-transition-new(root)")).toBeUndefined();
  });
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
  await startFromHome(page);
  await expect.poll(async () => (await played(page)).length).toBe(2);
  const cover = (await played(page))[1]!;
  expect(cover.types).toEqual(["cover"]);
  const rise = animation(cover, "::view-transition-new(root)");
  expect(rise).toMatchObject({ duration: 450, easing: SHEET });
  expect(rise!.keyframes[0]!.transform).toBe("translateY(100%)");
  // The dock fades out as the cover takes the screen, and comes back as it leaves.
  expect(animation(cover, "::view-transition-old(dock)")!.keyframes.at(-1)!.opacity).toBe("0");

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  await expect.poll(async () => (await played(page)).length).toBe(3);
  const uncover = (await played(page))[2]!;
  expect(uncover.types).toEqual(["uncover"]);
  const sink = animation(uncover, "::view-transition-old(root)");
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

test("the leaving page moves from where it was on screen, for push, pop, cover and uncover", async ({
  page,
}) => {
  await page.unroute("**/api/me");
  await fakeServer(page);
  await page.setViewportSize({ width: 390, height: 500 });
  await recordTransitions(page);
  // Push and pop from the tools list scrolled past its first tools.
  await page.goto("/tools");
  const bmi = page.getByRole("link", { name: /^BMI/ });
  await bmi.scrollIntoViewIfNeeded();
  await bmi.click();
  await expect(page.getByRole("heading", { level: 1, name: "BMI" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Tools" })).toBeVisible();
  // Cover from a scrolled Home, uncover from a scrolled session.
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  // Shorter, so Home scrolls while its session card stays in view.
  await page.setViewportSize({ width: 390, height: 400 });
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, 100);
        return [window.scrollY, document.documentElement.scrollHeight];
      }),
    )
    .toEqual([100, expect.any(Number)]);
  await page.getByRole("link", { name: /^Session [ABC] · / }).click();
  // The preview, scrolled before its Start raises the session.
  const start = page.getByRole("link", { name: "Start the session" });
  await expect(start).toBeVisible();
  // Once the push has landed, so the router's settling of the new page comes before the scroll.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((a) =>
              (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition"),
            ).length,
      ),
    )
    .toBe(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        window.scrollTo(0, 100);
        return window.scrollY;
      }),
    )
    .toBe(100);
  await start.click();
  await expect(page.getByRole("button", { name: "Finish" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  await expect.poll(async () => (await played(page)).length).toBe(5);
  const all = await played(page);
  expect(all.map((p) => p.types)).toEqual([["push"], ["pop"], ["push"], ["cover"], ["uncover"]]);
  for (const p of all) {
    // From the scrolled tools list, Home, preview and session (the BMI page is short and opens
    // at its top).
    if (p.types[0] !== "pop") expect.soft(p.page.scrollY, p.types[0]).toBeGreaterThan(50);
    expect.soft(Math.round(p.page.drawn), p.types[0]).toBe(Math.round(p.page.top));
  }
});
