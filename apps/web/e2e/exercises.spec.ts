import { expect, type Locator, type Page, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// Only static checks here: styles and boxes, on a clock that stands still.
const NOW = new Date("2026-10-07T18:00:00+02:00");
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

async function openLibrary(page: Page) {
  await fakeServer(page);
  await page.goto("/workouts?tab=exercises");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { name: "All · 1,291" })).toBeVisible();
}

// A colour token as the browser resolves it, through a throwaway element.
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement("div");
    probe.style.backgroundColor = `var(${t})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return color;
  }, token);

const chipLook = (chip: Locator) =>
  chip.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      border: s.borderTopWidth,
      bg: s.backgroundColor,
      h: el.getBoundingClientRect().height,
    };
  });

test("the Muscle and Equipment chips are filled and borderless, at least 44 px", async ({
  page,
}) => {
  await openLibrary(page);
  const track = await tokenColor(page, "--track");
  for (const name of ["Muscle", "Equipment"]) {
    const look = await chipLook(page.getByRole("button", { name }));
    expect(look.border).toBe("0px");
    expect(look.bg).toBe(track);
    expect(look.h).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: "Muscle" }).click();
  const sheet = page.getByRole("dialog", { name: "Muscle" });
  const chest = sheet.getByRole("radio", { name: "Chest" });
  const look = await chipLook(chest);
  expect(look.border).toBe("0px");
  expect(look.bg).toBe(track);
  expect(look.h).toBeGreaterThanOrEqual(44);
  // Chosen, it turns to the foreground.
  await chest.click();
  const fg = await tokenColor(page, "--foreground");
  expect((await chipLook(chest)).bg).toBe(fg);
});

for (const scheme of ["light", "dark"] as const) {
  test(`each list sits in one grouped card of 72 px rows split by hairlines, ${scheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openLibrary(page);
    const lists = page.getByRole("main").getByRole("list");
    for (const index of [0, 1]) {
      const list = lists.nth(index);
      const card = await list.evaluate((el) => {
        const s = getComputedStyle(el);
        return { shadow: s.boxShadow, border: s.borderTopWidth, radius: s.borderTopLeftRadius };
      });
      expect(card.radius).not.toBe("0px");
      if (scheme === "light") expect(card.shadow).not.toBe("none");
      else expect(card.border).toBe("1px");
      const rows = await list.getByRole("link").evaluateAll((links) =>
        links.slice(0, 4).map((a) => ({
          h: a.getBoundingClientRect().height,
          line: getComputedStyle(a).borderTopWidth,
        })),
      );
      expect(rows.map((r) => r.h)).toEqual([72, 72, 72, 72]);
      expect(rows.map((r) => r.line)).toEqual(["0px", "1px", "1px", "1px"]);
    }
  });
}

test("section headers are 13 px, 600, muted", async ({ page }) => {
  await openLibrary(page);
  const muted = await tokenColor(page, "--muted-foreground");
  for (const name of ["In your program", "All · 1,291"]) {
    const s = await page.getByRole("heading", { name }).evaluate((el) => {
      const c = getComputedStyle(el);
      return { size: c.fontSize, weight: c.fontWeight, color: c.color };
    });
    expect(s).toEqual({ size: "13px", weight: "600", color: muted });
  }
});

test("a program row ends in its badge, another in a 16 px chevron", async ({ page }) => {
  await openLibrary(page);
  const lists = page.getByRole("main").getByRole("list");
  const bench = lists.nth(0).getByRole("link", { name: /Barbell bench press/ });
  // The badge is the row's last piece, after the name.
  const badge = bench.getByText("Sessions A", { exact: true });
  await expect(badge).toBeVisible();
  expect(await bench.evaluate((a) => a.lastElementChild?.textContent)).toBe("Sessions A");
  const other = lists.nth(1).getByRole("link").first();
  const size = await other
    .locator("svg")
    .last()
    .evaluate((el) => {
      const b = el.getBoundingClientRect();
      return [b.width, b.height];
    });
  expect(size).toEqual([16, 16]);
});

test("at 360 px a long name ends in an ellipsis and nothing scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await openLibrary(page);
  const name = page
    .getByRole("main")
    .getByRole("list")
    .nth(0)
    .getByText("Dumbbell seated shoulder press", { exact: true });
  const fit = await name.evaluate((el) => ({
    overflow: getComputedStyle(el).textOverflow,
    cut: el.scrollWidth > el.clientWidth,
  }));
  expect(fit).toEqual({ overflow: "ellipsis", cut: true });
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBe(0);
});
