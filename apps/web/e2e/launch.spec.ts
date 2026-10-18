import { expect, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";
import { readMotion, recordMotion } from "./motion";

test.use({ locale: "en-US" });

const OUT = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const BREATHE = "cubic-bezier(0.42, 0, 0.58, 1)";

// Holds /api/me until the returned function is called.
async function holdAccount(page: Page) {
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route("**/api/me", async (route) => {
    await held;
    await route.fallback();
  });
  return answer;
}

test("a signed-in launch never shows the signed-out header", async ({ page }) => {
  await fakeServer(page);
  // Every heading the page has held, taken at each DOM change from the first byte on: a frame
  // that lasts a few milliseconds still lands here.
  await page.addInitScript(() => {
    const seen = new Set<string>();
    (window as unknown as { seenHeadings: Set<string> }).seenHeadings = seen;
    new MutationObserver(() => {
      for (const h of document.querySelectorAll("h1")) seen.add(h.textContent ?? "");
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  const seen = await page.evaluate(() => [
    ...(window as unknown as { seenHeadings: Set<string> }).seenHeadings,
  ]);
  expect(seen).not.toContain("Belay");
});

test("the launch screen stays until the account is known, then leaves", async ({ page }) => {
  await fakeServer(page);
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  await page.route("**/api/me", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto("/");
  await page.waitForFunction(() => document.getElementById("root")!.childElementCount > 0);
  await expect(page.locator(".launch")).toBeVisible();
  answer();
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
});

test("with reduced motion the launch screen leaves at once, without a fade", async ({ page }) => {
  await fakeServer(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  // The screen's visibility the moment it is told to leave: a fade would keep it visible.
  await page.addInitScript(() => {
    const at: string[] = [];
    (window as unknown as { leaving: string[] }).leaving = at;
    new MutationObserver(() => {
      const launch = document.querySelector(".launch");
      if (launch && document.body.classList.contains("launched") && at.length === 0)
        at.push(getComputedStyle(launch).visibility);
    }).observe(document, { attributes: true, attributeFilter: ["class"], subtree: true });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { leaving: string[] }).leaving)).toEqual([
    "hidden",
  ]);
});

test("an account question that never gets an answer lets the launch screen go after 4 s", async ({
  page,
}) => {
  await fakeServer(page);
  // No remembered user in a fresh context, and /api/me never answers.
  await page.route("**/api/me", () => {});
  await page.goto("/");
  await page.waitForFunction(() => document.getElementById("root")!.childElementCount > 0);
  await expect(page.locator(".launch")).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden({ timeout: 4_500 });
  // Home keeps the mark and says it is loading, with no title to take back later.
  await expect(page.getByRole("status").filter({ hasText: "Loading…" })).toBeAttached();
  await expect(page.locator("[data-pending] .loader-mark")).toBeVisible();
  await expect(page.locator("h1")).toHaveCount(0);
});

test("while the account is unknown the launch mark's hooks breathe in turn from 600 ms", async ({
  page,
}) => {
  await recordMotion(page);
  await fakeServer(page);
  const answer = await holdAccount(page);
  await page.goto("/");
  await expect(page.locator(".launch")).toBeVisible();
  await expect
    .poll(async () => (await readMotion(page)).filter((m) => m.target === "path[data-hook]"))
    .toHaveLength(2);
  const hooks = (await readMotion(page)).filter((m) => m.target === "path[data-hook]");
  for (const delay of [600, 1200]) {
    expect(hooks).toContainEqual(
      expect.objectContaining({
        kind: "animation",
        duration: 1200,
        delay,
        easing: BREATHE,
        transforms: false,
      }),
    );
  }
  answer();
});

test("the launch screen fades out in 240 ms on the out curve once the account is known", async ({
  page,
}) => {
  await recordMotion(page);
  await fakeServer(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Hello, Ada" })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
  const fades = (await readMotion(page)).filter(
    (m) => m.target === "div" && m.kind === "transition" && m.duration > 0,
  );
  expect(fades).toContainEqual(
    expect.objectContaining({ duration: 240, delay: 0, easing: OUT, transforms: false }),
  ); // Hidden, the screen stays in the page: its breathing stops rather than run behind the app.
  const states = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => (a.effect as KeyframeEffect | null)?.target?.matches(".launch path"))
      .map((a) => a.playState),
  );
  expect(states).toEqual(["paused", "paused"]);
});

test("with reduced motion the launch hooks stand still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordMotion(page);
  await fakeServer(page);
  const answer = await holdAccount(page);
  await page.goto("/");
  await expect(page.locator(".launch")).toBeVisible();
  // Past the 600 ms the hooks would wait before breathing, and a full breath on.
  await page.waitForTimeout(1_500);
  expect((await readMotion(page)).filter((m) => m.target === "path[data-hook]")).toEqual([]);
  answer();
});
