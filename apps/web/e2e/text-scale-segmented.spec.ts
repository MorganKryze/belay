import { expect, type Page, test } from "@playwright/test";
import { settled } from "./axe";
import { fakeServer } from "./fake-server";
import { asAndroid } from "./native";

// French labels are the longest: at the phone's largest text sizes each option of a segmented
// control still holds its whole word, and no option runs into the next.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
});

// Each option whose label is wider than its button, and each pair of options that overlap.
const crowded = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[role=radiogroup]")].flatMap((group) => {
      const options = [...group.querySelectorAll<HTMLElement>("[role=radio]")];
      const boxes = options.map((el) => el.getBoundingClientRect());
      const text = (el: HTMLElement) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect();
      };
      const wide = options
        .filter((el, i) => {
          const t = text(el);
          const b = boxes[i]!;
          return (
            el.scrollWidth > el.clientWidth + 1 || t.left < b.left - 1 || t.right > b.right + 1
          );
        })
        .map((el) => `"${el.textContent}" wider than its button`);
      const overlaps = boxes.flatMap((a, i) =>
        boxes
          .slice(i + 1)
          .filter((b) => a.left < b.right - 1 && b.left < a.right - 1)
          .filter((b) => a.top < b.bottom - 1 && b.top < a.bottom - 1)
          .map(() => `"${options[i]!.textContent}" overlaps another option`),
      );
      return [...wide, ...overlaps];
    }),
  );

for (const width of [360, 390, 411]) {
  for (const textScale of [1, 2, 2.35]) {
    test(`text scale x${textScale} at ${width} px keeps Séances' segments whole`, async ({
      page,
    }) => {
      await asAndroid(page, { textScale });
      await page.setViewportSize({ width, height: 800 });
      await fakeServer(page);
      await page.goto("/workouts?tab=program");
      const group = page.getByRole("radiogroup", { name: "Afficher" });
      await expect(group.getByRole("radio", { name: "Programme" })).toBeChecked();
      await expect(page.locator(".launch")).toBeHidden();
      await settled(page);

      expect(await crowded(page)).toEqual([]);
      for (const radio of await group.getByRole("radio").all()) {
        const box = (await radio.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      // The thumb sits under the chosen option, wherever the options are laid out.
      const thumb = (await group.locator("[data-slot=segmented-thumb]").boundingBox())!;
      const chosen = (await group.getByRole("radio", { checked: true }).boundingBox())!;
      expect(Math.abs(thumb.x - chosen.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(thumb.y - chosen.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(thumb.width - chosen.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(thumb.height - chosen.height)).toBeLessThanOrEqual(1);
    });
  }
}

// Measuring the labels lays the page out once; a thumb drawn side by side then would slide across
// to its row each time the screen opens.
test("text scale x2 opens Séances with the thumb already on the chosen row", async ({ page }) => {
  await asAndroid(page, { textScale: 2 });
  await page.setViewportSize({ width: 411, height: 800 });
  await fakeServer(page);
  await page.goto("/workouts?tab=program");
  await expect(page.locator(".launch")).toBeHidden();
  const tabs = page.getByRole("navigation", { name: "Principale" });
  await tabs.getByRole("link", { name: "Accueil" }).press("Enter");
  await settled(page);

  // Every transition the thumb starts as the screen opens.
  await page.evaluate(() => {
    const w = window as unknown as { slides: string[] };
    w.slides = [];
    document.addEventListener(
      "transitionrun",
      (e) => {
        if ((e.target as HTMLElement).dataset.slot === "segmented-thumb")
          w.slides.push(e.propertyName);
      },
      true,
    );
  });
  await tabs.getByRole("link", { name: "Séances" }).press("Enter");
  const group = page.getByRole("radiogroup", { name: "Afficher" });
  await expect(group).toHaveAttribute("data-stacked", "true");
  await expect(group.getByRole("radio", { name: "Programme" })).toBeChecked();
  await settled(page);
  expect(await page.evaluate(() => (window as unknown as { slides: string[] }).slides)).toEqual([]);
});
