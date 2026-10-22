import type { Change } from "@belay/shared/sync/schema";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";

// A stepper's number field: the input's own box is a 44 px target, not only the field around it.
test.use({ locale: "en-US", viewport: { width: 390, height: 844 } });

type Boxes = {
  height: number;
  // The input's own box, to read the rest against.
  box: { left: number; right: number; top: number };
  fontSize: number;
  // The value's text box (right-aligned in the input, its line centred in the input's box) and
  // the unit's (a Range around its text); each with its baseline.
  value: { left: number; right: number; top: number; baseline: number };
  unit: { left: number; top: number; baseline: number } | null;
};

const boxes = (input: Locator): Promise<Boxes> =>
  input.evaluate((el: HTMLInputElement) => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    const metrics = (node: Element, text: string) => {
      const s = getComputedStyle(node);
      ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const m = ctx.measureText(text);
      return { width: m.width, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
    };
    const b = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    const v = metrics(el, el.value);
    const top = b.top + b.height / 2 - (v.ascent + v.descent) / 2;
    const right = b.right - parseFloat(s.paddingRight) - parseFloat(s.borderRightWidth);
    const unitId = (el.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .find((i) => i.endsWith("-unit"));
    const unitEl = unitId ? document.getElementById(unitId) : null;
    let unit = null;
    if (unitEl) {
      const range = document.createRange();
      range.selectNodeContents(unitEl);
      const u = range.getBoundingClientRect();
      const um = metrics(unitEl, unitEl.textContent ?? "");
      unit = { left: u.left, top: u.top, baseline: u.top + um.ascent };
    }
    return {
      height: b.height,
      box: { left: b.left, right: b.right, top: b.top },
      fontSize: parseFloat(s.fontSize),
      value: { left: right - v.width, right, top, baseline: top + v.ascent },
      unit,
    };
  });

// A height another device sent, so Profile shows its fields filled.
const HEIGHT: Change = {
  kind: "profile",
  field: "height",
  value: 178,
  at: "2026-10-01T06:30:00.000Z",
};

const PAGES: [string, (page: Page) => Promise<void>][] = [
  [
    "/tools/plates",
    async (page) => {
      await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
      await page.goto("/tools/plates");
      await expect(page.locator(".launch")).toBeHidden();
      await expect(page.getByRole("textbox", { name: "Target" })).toBeVisible();
    },
  ],
  [
    "/tools/bmi",
    async (page) => {
      await page.route("**/api/me", (r) => r.fulfill({ status: 401 }));
      await page.goto("/tools/bmi");
      await expect(page.locator(".launch")).toBeHidden();
      await expect(page.getByRole("textbox", { name: "Weight" })).toBeVisible();
    },
  ],
  [
    "/settings/profile",
    async (page) => {
      await fakeServer(page, { rows: WEEKS, changes: [HEIGHT] });
      await page.goto("/settings/profile");
      await expect(page.locator(".launch")).toBeHidden();
      await expect(page.getByRole("textbox", { name: "Height" })).toBeVisible();
    },
  ],
  [
    "the weigh-in sheet",
    async (page) => {
      await fakeServer(page, { rows: WEEKS });
      await page.goto("/");
      await expect(page.locator(".launch")).toBeHidden();
      await page.getByRole("button", { name: /^Weigh-in/ }).click();
      await expect(
        page.getByRole("dialog", { name: "Weigh-in" }).getByRole("textbox", { name: "Weight" }),
      ).toBeVisible();
    },
  ],
];

for (const [name, open] of PAGES) {
  test(`${name}: every stepper's number field is at least 44 px tall on its own box, with text of at least 16 px`, async ({
    page,
  }) => {
    await open(page);
    const inputs = page.locator(".field input[inputmode=decimal]");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      if (!(await input.isVisible())) continue;
      const label = await input.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent);
      const b = await boxes(input);
      expect(b.height, `input "${label}" height`).toBeGreaterThanOrEqual(44);
      expect(b.fontSize, `input "${label}" font size`).toBeGreaterThanOrEqual(16);
      if (b.unit) expect(Math.abs(b.unit.baseline - b.value.baseline)).toBeLessThanOrEqual(1);
    }
  });
}

// Measured on the base at 390 px, light, before the input filled its field (value "100", unit
// "kg"), as offsets from the input's own box: the page can move, the field's contents may not.
const BEFORE = {
  value: { right: 0, top: 12, baseline: 31 },
  unit: { left: 2, top: 18, baseline: 31 },
};

test("the value and its unit stay where they were, on one baseline", async ({ page }) => {
  await PAGES[0]![1](page);
  const b = await boxes(page.getByRole("textbox", { name: "Target" }));
  const near = (got: number, want: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(1);
  near(b.value.right - b.box.right, BEFORE.value.right);
  near(b.value.top - b.box.top, BEFORE.value.top);
  near(b.value.baseline - b.box.top, BEFORE.value.baseline);
  near(b.unit!.left - b.box.right, BEFORE.unit.left);
  near(b.unit!.top - b.box.top, BEFORE.unit.top);
  near(b.unit!.baseline - b.box.top, BEFORE.unit.baseline);
  near(b.unit!.baseline, b.value.baseline);
});

test("a tap anywhere in the field still lands the caret in it", async ({ page }) => {
  await PAGES[0]![1](page);
  const input = page.getByRole("textbox", { name: "Target" });
  const field = input.locator("xpath=..");
  const box = (await field.boundingBox())!;
  await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2);
  await expect(input).toBeFocused();
});
