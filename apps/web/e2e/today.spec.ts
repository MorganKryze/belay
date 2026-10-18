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
  await expect(page.getByRole("region", { name: "Aujourd'hui" })).toHaveAttribute(
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
