import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock: Accueil's date is today's, as Paris has it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// Session A started ten minutes ago, still open.
const RUNNING = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const runningA = (): Change[] => {
  const at = new Date(Date.now() - 10 * 60_000).toISOString();
  return [
    {
      kind: "workout",
      id: RUNNING,
      field: "start",
      sessionCode: "A",
      plan: [...sessionByCode("A")!.slots],
      startedAt: at,
      at,
    },
  ];
};

const sessionCard = (page: Page) => page.getByRole("region", { name: /^Session A · Push/ });

async function openHome(page: Page, changes: Change[] = []) {
  await fakeServer(page, { changes });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(sessionCard(page)).toBeVisible();
}

test("Accueil opens on today's date above the greeting", async ({ page }) => {
  const today = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  await openHome(page);
  const date = page.getByText(today, { exact: true });
  const h1 = page.getByRole("heading", { level: 1, name: "Hello, Ada" });
  await expect(date).toBeVisible();
  const [dateBox, titleBox] = [(await date.boundingBox())!, (await h1.boundingBox())!];
  expect(dateBox.y + dateBox.height).toBeLessThanOrEqual(titleBox.y + 1);
  const style = await date.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: s.fontSize, weight: s.fontWeight, color: s.color };
  });
  // Muted, in the colour of the card's own muted line.
  const muted = await sessionCard(page)
    .getByText(/exercises · about/)
    .evaluate((el) => getComputedStyle(el).color);
  expect(style).toEqual({ size: "13px", weight: "500", color: muted });
});

test("the next session's card pushes its preview", async ({ page }) => {
  await openHome(page);
  const card = sessionCard(page);
  await expect(card).toContainText("Next up · 6 exercises · about 55 min");
  await card.getByRole("link", { name: "See the session" }).click();
  await expect(page).toHaveURL(/\/workouts\/session\/A\?from=home$/);
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home" }),
  ).toHaveAttribute("aria-current", "page");
});

test("with a session open the card resumes it", async ({ page }) => {
  await openHome(page, runningA());
  const card = sessionCard(page);
  await expect(card).toContainText("In progress · 0 of 19 sets");
  await card.getByRole("link", { name: "Resume" }).click();
  await expect(page).toHaveURL(/\/workout$/);
  await expect(page.getByRole("button", { name: "Finish", exact: true })).toBeVisible();
});

test("the session card sits on the kit's surface: a ring in light, a border in dark", async ({
  page,
}) => {
  const surface = () =>
    sessionCard(page).evaluate((el) => {
      const s = getComputedStyle(el);
      return { shadow: s.boxShadow, border: s.borderTopWidth, radius: s.borderTopLeftRadius };
    });
  await page.addInitScript(() => localStorage.setItem("belay.theme", "light"));
  await openHome(page);
  const light = await surface();
  expect(light.shadow).toContain("rgba(28, 25, 23, 0.035) 0px 0px 0px 1px");
  expect(light.border).toBe("0px");
  expect(light.radius).toBe("18px");
  await page.addInitScript(() => localStorage.setItem("belay.theme", "dark"));
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(sessionCard(page)).toBeVisible();
  expect(await surface()).toEqual({ shadow: "none", border: "1px", radius: "18px" });
});

for (const theme of ["light", "dark"] as const) {
  test(`Accueil with the next session has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await openHome(page);
    await expectNoAxeViolations(page);
  });

  test(`Accueil with a session open has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await openHome(page, runningA());
    await expect(sessionCard(page)).toContainText("In progress");
    await expectNoAxeViolations(page);
  });
}
