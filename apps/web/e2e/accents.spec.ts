import { expect, type Page, test } from "@playwright/test";
import { fakeServer, WEEKS } from "./fake-server";
import { SCREENS } from "./key-screens";

// Each domain has a pale tint and a readable shade, shown where domains meet: on Accueil only.
// They mark a chip, a tile or a pill, never a control, and the blue stays with the next action.
test.use({ locale: "en-US", timezoneId: "Europe/Paris", viewport: { width: 390, height: 844 } });

// Wednesday 7 October 2026, 6 p.m. in Paris, the day the fixture's weeks lead up to.
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-07T18:00:00+02:00"));
});

const DOMAINS = ["session", "body", "activity", "intake", "rest"] as const;
const CONTROL =
  "a, button, input, select, textarea, [role=button], [role=link], [role=radio], [role=tab], [role=switch], [role=checkbox], [tabindex]";

// A colour as the page paints it.
const colour = (page: Page, value: string) =>
  page.evaluate((v) => {
    const probe = document.createElement("i");
    probe.style.color = v;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, value);

// Every domain colour of the current theme, by its token name.
async function domainColours(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const d of DOMAINS)
    for (const part of ["tint", "shade"])
      out[`${d}-${part}`] = await colour(page, `var(--${d}-${part})`);
  return out;
}

// WCAG contrast between two rgb() colours.
function ratio(a: string, b: string): number {
  const lum = (c: string) => {
    const [r, g, bl] = c
      .match(/\d+(\.\d+)?/g)!
      .slice(0, 3)
      .map(Number) as [number, number, number];
    const ch = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(bl);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

// The controls on the page whose own fill, edge or words take a colour from `colours`.
const paintedControls = (page: Page, colours: string[]) =>
  page.evaluate(
    ([selector, list]) =>
      [...document.querySelectorAll(selector)]
        .filter((el) => {
          const s = getComputedStyle(el);
          const paints = [s.backgroundColor, s.borderTopColor, s.color];
          return paints.some((p) => list.includes(p));
        })
        .map((el) => el.outerHTML.slice(0, 120)),
    [CONTROL, colours] as const,
  );

async function openHome(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
  await fakeServer(page, { rows: WEEKS });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Weigh-in/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "See the session" })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
}

for (const theme of ["light", "dark"] as const) {
  test.describe(theme, () => {
    test("Accueil wears each domain's tint and shade", async ({ page }) => {
      await openHome(page, theme);
      const c = await domainColours(page);
      const session = page
        .getByRole("region", { name: /^Session A/ })
        .locator('[data-accent="session"]');
      await expect(session).toHaveText("Next up");
      await expect(session).toHaveCSS("background-color", c["session-tint"]!);
      await expect(session).toHaveCSS("color", c["session-shade"]!);
      const trend = page.getByRole("link", { name: /^7-day average/ });
      const body = trend.locator('[data-accent="body"]').first();
      await expect(body).toHaveText("7-day average");
      await expect(body).toHaveCSS("background-color", c["body-tint"]!);
      await expect(body).toHaveCSS("color", c["body-shade"]!);
      const pill = trend.locator("[data-slot=range-pill]");
      await expect(pill).toHaveText("in your range");
      await expect(pill).toHaveCSS("background-color", c["body-tint"]!);
      await expect(pill.locator("svg.lucide-check")).toHaveCSS("color", c["body-shade"]!);
      const tiles = page.getByRole("region", { name: "Today" }).locator("[data-accent]");
      await expect(tiles).toHaveCount(4);
      const expected = ["activity", "body", "intake", "intake"];
      for (const [i, d] of expected.entries()) {
        const tile = tiles.nth(i);
        await expect(tile).toHaveAttribute("data-accent", d);
        await expect(tile).toHaveCSS("background-color", c[`${d}-tint`]!);
        await expect(tile).toHaveCSS("color", c[`${d}-shade`]!);
      }
    });

    test("the band lies at the top, and muted words keep 4.5:1 on it", async ({ page }) => {
      await openHome(page, theme);
      const band = page.locator("[data-band]");
      await expect(band).toBeAttached();
      const box = (await band.boundingBox())!;
      expect(box.y).toBeLessThanOrEqual(0);
      expect(box.height).toBeGreaterThan(100);
      expect(box.width).toBeGreaterThanOrEqual(390);
      const tint = await colour(page, "var(--session-tint)");
      expect(await band.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(tint);
      const muted = await colour(page, "var(--muted-foreground)");
      expect(ratio(muted, tint)).toBeGreaterThanOrEqual(4.5);
      // It scrolls away with the title, never held in place.
      expect(await band.evaluate((el) => getComputedStyle(el).position)).toBe("absolute");
    });

    test("no accent is a control and no control wears an accent", async ({ page }) => {
      await openHome(page, theme);
      const c = await domainColours(page);
      const accents = page.locator("[data-accent]");
      expect(await accents.count()).toBeGreaterThan(0);
      for (const el of await accents.all()) {
        expect(await el.evaluate((e, sel) => e.matches(sel), CONTROL)).toBe(false);
        // Each accent comes with its words or its icon.
        const said = await el.evaluate(
          (e) => (e.textContent ?? "").trim() !== "" || e.querySelector("svg") !== null,
        );
        expect(said).toBe(true);
      }
      // The session's shade is the action's own blue, which the next action keeps.
      const domainOnly = Object.entries(c).filter(([k]) => k !== "session-shade");
      expect(
        await paintedControls(
          page,
          domainOnly.map(([, v]) => v),
        ),
      ).toEqual([]);
      // No accent, nor anything in it, is filled with the action's blue.
      const mark = await colour(page, "var(--mark)");
      const filled = await page.evaluate(
        (m) =>
          [...document.querySelectorAll("[data-accent], [data-accent] *")].filter(
            (e) => getComputedStyle(e).backgroundColor === m,
          ).length,
        mark,
      );
      expect(filled).toBe(0);
      // The session chip is a chip, never a fill of a control.
      const chip = page.locator('[data-accent="session"]');
      expect((await chip.boundingBox())!.height).toBeLessThan(32);
      expect(await chip.evaluate((e, sel) => e.closest(sel) === null, CONTROL)).toBe(true);
    });

    test("the tab bar, links and focus ring keep their colours", async ({ page }) => {
      await openHome(page, theme);
      const c = Object.values(await domainColours(page));
      const ink = await colour(page, "var(--primary-ink)");
      const tab = page.getByRole("navigation", { name: "Main" }).locator("[aria-current=page]");
      await expect(tab.first()).toHaveCSS("color", ink);
      expect(await colour(page, "var(--ring)")).toBe(await colour(page, "var(--mark)"));
      const see = page.getByRole("link", { name: "See the session" });
      await expect(see).toHaveCSS("background-color", await colour(page, "var(--mark)"));
      const tints = c.filter((_, i) => i % 2 === 0);
      expect(tints).not.toContain(await colour(page, "var(--ring)"));
      await see.focus();
      const ring = await see.evaluate((e) => getComputedStyle(e).outlineColor);
      expect(ring).toBe(await colour(page, "var(--ring)"));
    });

    test.describe("the other key screens keep their colours", () => {
      // The weigh-in sheet rises over Accueil, whose accents stay under it.
      const others = SCREENS.filter(([n]) => n !== "Home" && n !== "the weigh-in sheet");
      for (const [name, reach] of others) {
        test(name, async ({ page }) => {
          await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
          await reach(page);
          await expect(page.locator(".launch")).toBeHidden();
          await expect(page.locator("[data-accent]")).toHaveCount(0);
          await expect(page.locator("[data-band]")).toHaveCount(0);
          // The session shade is the mark's blue, which these screens keep for their action.
          const c = await domainColours(page);
          const others = Object.entries(c)
            .filter(([k]) => k !== "session-shade")
            .map(([, v]) => v);
          const painted = await page.evaluate((list) => {
            const hits: string[] = [];
            for (const el of document.body.querySelectorAll("*")) {
              const s = getComputedStyle(el);
              if ([s.backgroundColor, s.color, s.borderTopColor].some((p) => list.includes(p)))
                hits.push(el.outerHTML.slice(0, 120));
            }
            return hits;
          }, others);
          expect(painted).toEqual([]);
        });
      }
    });
  });
}

test.describe("the band goes where plainer grounds are asked for", () => {
  test("with more contrast", async ({ page }) => {
    await page.emulateMedia({ contrast: "more" });
    await openHome(page, "light");
    await expect(page.locator("[data-band]")).toBeHidden();
  });

  test("with forced colours", async ({ page }) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openHome(page, "light");
    await expect(page.locator("[data-band]")).toBeHidden();
  });
});
