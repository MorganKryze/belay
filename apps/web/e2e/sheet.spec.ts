import { expect, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T08:00:00+02:00"));
});

type Played = { on: "card" | "overlay"; name: string; duration: number; easing: string };

// The CSS animations running or held on the open sheet and its overlay, read from the page.
const played = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a): a is CSSAnimation => a instanceof CSSAnimation)
      .flatMap((a) => {
        const target = (a.effect as KeyframeEffect).target;
        const on = target?.matches("[role=dialog]")
          ? "card"
          : target?.matches("[data-sheet-overlay]")
            ? "overlay"
            : null;
        if (!on) return [];
        const timing = a.effect!.getTiming();
        const easing = (a.effect as KeyframeEffect).getKeyframes()[0]?.easing ?? "";
        return [{ on, name: a.animationName, duration: Number(timing.duration), easing }];
      }),
  ) as Promise<Played[]>;

async function openIntake(page: Page) {
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await page.getByRole("button", { name: /^Intake/ }).click();
  const sheet = page.getByRole("dialog", { name: "Intake" });
  await expect(sheet).toBeVisible();
  return sheet;
}

// Clicks the close button and reads the animations as soon as the card turns closed, long before
// its exit can end; getAnimations() brings styles up to date.
const closeAndRead = (page: Page) =>
  page.evaluate(async () => {
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    const turned = new Promise<void>((resolve) =>
      new MutationObserver((_, observer) => {
        observer.disconnect();
        resolve();
      }).observe(dialog, { attributeFilter: ["data-state"] }),
    );
    dialog.querySelector<HTMLElement>("button[aria-label=Close]")!.click();
    await turned;
    return {
      attached: document.querySelector("[role=dialog]")?.getAttribute("data-state") ?? null,
      animations: document
        .getAnimations()
        .filter((a): a is CSSAnimation => a instanceof CSSAnimation)
        .filter((a) => a.playState === "running")
        .map((a) => ({
          name: a.animationName,
          duration: Number(a.effect!.getTiming().duration),
          easing: (a.effect as KeyframeEffect).getKeyframes()[0]?.easing ?? "",
          card: (a.effect as KeyframeEffect).target?.matches("[role=dialog]") ?? false,
        })),
    };
  });

test("a sheet rises in 450 ms on the sheet curve over a 300 ms overlay", async ({ page }) => {
  await openIntake(page);
  expect(await played(page)).toEqual(
    expect.arrayContaining([
      { on: "card", name: "sheet-in", duration: 450, easing: "cubic-bezier(0.4, 0.2, 0, 1)" },
      { on: "overlay", name: "fade-in", duration: 300, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    ]),
  );
});

test("closing runs 260 ms down and a 200 ms overlay before the sheet leaves", async ({ page }) => {
  const sheet = await openIntake(page);
  const { attached, animations } = await closeAndRead(page);
  expect(attached).toBe("closed");
  expect(animations).toEqual(
    expect.arrayContaining([
      { name: "sheet-out", duration: 260, easing: "cubic-bezier(0.4, 0, 1, 1)", card: true },
      { name: "fade-out", duration: 200, easing: "cubic-bezier(0.4, 0, 1, 1)", card: false },
    ]),
  );
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("button", { name: /^Intake/ })).toBeFocused();
});

test("a second tap on Save while the sheet leaves writes nothing, and Undo brings back the first value", async ({
  page,
}) => {
  await fakeServer(page, { rows: [...WEEKS, { date: "2026-10-07", weightKg: 81.2 }] });
  await page.goto("/");
  const line = page.getByRole("button", { name: /^Weigh-in/ });
  await expect(line).toContainText("81.2 kg");
  await line.click();
  const sheet = page.getByRole("dialog", { name: "Weigh-in" });
  await sheet.getByRole("textbox", { name: "Weight" }).fill("80.5");
  // Saves, then taps the same spot as soon as the card turns closed, through the page's own hit
  // test, the way a finger lands during the exit.
  const hitSave = await page.evaluate(async () => {
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    const save = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Save")!;
    const box = save.getBoundingClientRect();
    const turned = new Promise<void>((resolve) =>
      new MutationObserver((_, observer) => {
        observer.disconnect();
        resolve();
      }).observe(dialog, { attributeFilter: ["data-state"] }),
    );
    save.click();
    await turned;
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    const button = hit?.closest("button");
    button?.click();
    return button === save;
  });
  expect(hitSave).toBe(false);
  await expect(sheet).toBeHidden();
  await expect(line).toContainText("80.5 kg");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(line).toContainText("81.2 kg");
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("a sheet is a 480 px centred dialog without a handle that scales in over 220 ms and fades out in 140 ms", async ({
    page,
  }) => {
    const sheet = await openIntake(page);
    const entered = await played(page);
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBe(480);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height / 2 - 400)).toBeLessThanOrEqual(1);
    await expect(sheet.locator("> div[aria-hidden]").first()).toBeHidden();
    expect(entered).toEqual(
      expect.arrayContaining([
        { on: "card", name: "dialog-in", duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      ]),
    );
    const { animations } = await closeAndRead(page);
    expect(animations).toEqual(
      expect.arrayContaining([
        { name: "fade-out", duration: 140, easing: "cubic-bezier(0.4, 0, 1, 1)", card: true },
      ]),
    );
    await expect(sheet).toBeHidden();
  });
});

test.describe("in French on a 360 px phone", () => {
  test.use({ locale: "fr-FR", viewport: { width: 360, height: 780 } });

  test("Nouvelle annotation and its date chip share the header without overflow", async ({
    page,
  }) => {
    await fakeServer(page, { rows: WEEKS });
    await page.goto("/body");
    await page.getByRole("button", { name: "Annotation", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Nouvelle annotation" });
    await sheet.getByLabel(/^Date de l.annotation$/).fill("2026-09-30");
    await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const title = (await sheet
      .getByRole("heading", { name: "Nouvelle annotation" })
      .boundingBox())!;
    const chip = (await sheet.getByText(/mer\.\s30\ssept\./i).boundingBox())!;
    const close = (await sheet.getByRole("button", { name: "Fermer" }).boundingBox())!;
    const card = (await sheet.boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(chip.x);
    expect(chip.x + chip.width).toBeLessThanOrEqual(close.x);
    expect(close.x + close.width).toBeLessThanOrEqual(card.x + card.width);
    expect(Math.abs(title.y + title.height / 2 - (close.y + close.height / 2))).toBeLessThan(4);
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(card.x).toBe(8);
    expect(card.width).toBe(344);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });
});
