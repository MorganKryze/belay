import { expect, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// On the real clock: the wait for the first sync is capped from the start of the visit.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

// Both rows have a value on the server, so neither may ever say nothing was entered.
const ROWS = ["Pesée", "Apports"];

test("a new device never says pas encore saisie before its first sync lands", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  await fakeServer(page, {
    rows: [{ date: today, weightKg: 80.4 }],
    changes: [
      { kind: "intake", date: today, field: "kcal", value: 2100, at: `${today}T06:00:00.000Z` },
    ],
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let asked = false;
  await page.route("**/api/sync", async (route) => {
    asked = true;
    await held;
    await route.fallback();
  });
  // Every text the rows show, from the first byte of the page.
  await page.addInitScript((rows) => {
    const seen: string[] = [];
    (window as unknown as { seen: string[] }).seen = seen;
    new MutationObserver(() => {
      for (const button of document.querySelectorAll("section button")) {
        const text = button.textContent ?? "";
        if (rows.some((r) => text.startsWith(r)) && seen.at(-1) !== text) seen.push(text);
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  }, ROWS);
  await page.goto("/");
  const weighIn = page.getByRole("button", { name: /^Pesée/ });
  await weighIn.waitFor({ state: "attached" });
  await expect.poll(() => asked).toBe(true);
  const blank = (await weighIn.boundingBox())!.height;
  await expect(page.getByRole("region", { name: "Aujourd’hui" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  release();
  await expect(weighIn).toContainText("80,4 kg");
  await expect(page.getByRole("button", { name: /^Apports/ })).toContainText("2\u202f100 kcal");
  // The blank line held the row's height: nothing below moved when the value came.
  expect((await weighIn.boundingBox())!.height).toBe(blank);
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter((t) => t.includes("pas encore saisi"))).toEqual([]);
});

const paris = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
// The colour a custom property resolves to, read the way the page paints it.
const tokenColour = (page: import("@playwright/test").Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);
const colour = (l: import("@playwright/test").Locator) =>
  l.evaluate((e) => getComputedStyle(e).color);

test("« Aujourd’hui » heads one grouped list of 56 px rows with 28 px icon squares and 16 px chevrons", async ({
  page,
}) => {
  await fakeServer(page);
  await page.goto("/");
  const region = page.getByRole("region", { name: "Aujourd’hui" });
  await expect(region.getByRole("heading", { name: "Aujourd’hui" })).toHaveAttribute("id", "today");
  await expect(region.getByRole("link", { name: /^Compléments/ })).toBeVisible();
  const rows = region.locator("button, a");
  await expect(rows).toHaveCount(4);
  for (const row of await rows.all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56);
    const square = (await row.locator("span[aria-hidden]").first().boundingBox())!;
    expect([square.width, square.height]).toEqual([28, 28]);
    const chevron = (await row.locator("svg.lucide-chevron-right").boundingBox())!;
    expect([chevron.width, chevron.height]).toEqual([16, 16]);
  }
  // One group: every row sits in the same card.
  const parents = await rows.evaluateAll((els) => new Set(els.map((e) => e.parentElement)).size);
  expect(parents).toBe(1);
});

for (const scheme of ["light", "dark"] as const) {
  test(`a logged value reads in the text ink after a check in the reference ink; a missing one in muted (${scheme})`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await fakeServer(page, { rows: [{ date: paris(), weightKg: 80.2 }] });
    await page.goto("/");
    const weighIn = page.getByRole("button", { name: /^Pesée/ });
    await expect(weighIn).toContainText("80,2 kg");
    expect(await colour(weighIn.getByText("80,2 kg"))).toBe(
      await tokenColour(page, "--foreground"),
    );
    expect(await colour(weighIn.locator("svg.lucide-check"))).toBe(
      await tokenColour(page, "--reference-ink"),
    );
    const intake = page.getByRole("button", { name: /^Apports/ });
    await expect(intake).toContainText("pas encore saisis");
    await expect(intake.locator("svg.lucide-check")).toHaveCount(0);
    expect(await colour(intake.getByText("pas encore saisis"))).toBe(
      await tokenColour(page, "--muted-foreground"),
    );
  });
}

test("the empty supplements row is muted, never orange", async ({ page }) => {
  await fakeServer(page);
  await page.goto("/");
  const link = page.getByRole("link", { name: /^Compléments/ });
  await expect(link).toContainText("aucun pour l’instant");
  await expect(link).toHaveAttribute("href", "/settings/supplements");
  const muted = await tokenColour(page, "--muted-foreground");
  expect(await colour(link.getByText("aucun pour l’instant"))).toBe(muted);
  const primary = await tokenColour(page, "--primary");
  const inks = await link.evaluate((root) =>
    [root, ...root.querySelectorAll("*")].map((e) => getComputedStyle(e).color),
  );
  expect(inks).not.toContain(primary);
});
