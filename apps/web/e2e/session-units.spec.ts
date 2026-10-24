import type { Change } from "@belay/shared/sync/schema";
import { kgToLb } from "@belay/shared/tools/units";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock throughout: the router and the rest timer read it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// Session A three days ago: the bench press at 80 kg × 8, 8, 7, 6 (176 lb) and one leg press set
// at 100 kg × 12 (220 lb).
const DAY = new Date(Date.now() - 3 * 86_400_000);
const at = (minutes: number) => new Date(DAY.getTime() + minutes * 60_000).toISOString();
const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const set = (
  k: number,
  slotIndex: number,
  exerciseId: string,
  weightKg: number,
  reps: number,
): Change => ({
  kind: "set",
  id: `0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e${slotIndex}${k}`,
  workoutId: LAST,
  field: "create",
  slotIndex,
  position: 3 + k,
  exerciseId,
  warmup: false,
  weightKg,
  reps,
  rir: 1,
  doneAt: at(5 + slotIndex * 15 + k * 3),
  at: at(5 + slotIndex * 15 + k * 3),
});
const LAST_A: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A", starterProgram)!.slots],
    startedAt: at(0),
    at: at(0),
  },
  ...[8, 8, 7, 6].map((reps, k) => set(k, 0, "ds:0025", 80, reps)),
  set(0, 2, "ds:0739", 100, 12),
  { kind: "workout", id: LAST, field: "ended", value: at(60), at: at(60) },
];
// Every work set's weight × reps, as the past session's volume adds them up.
const VOLUME_KG = 80 * (8 + 8 + 7 + 6) + 100 * 12;

// Session `code` open since five minutes ago, on top of last time.
function open(code: string): Change[] {
  const startedAt = new Date(Date.now() - 5 * 60_000).toISOString();
  return [
    ...LAST_A,
    {
      kind: "workout",
      id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01",
      field: "start",
      sessionCode: code,
      plan: [...sessionByCode(code, starterProgram)!.slots],
      startedAt,
      at: startedAt,
    },
  ];
}

// The unit is a device preference, set before the app reads it; Home's card resumes the session.
async function resume(page: Page, code: string) {
  await page.addInitScript(() => localStorage.setItem("belay.weightUnit", "lb"));
  const server = await fakeServer(page, { changes: open(code) });
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  const card = page.getByRole("region", { name: new RegExp(`^Session ${code} · `) });
  await expect(card).toContainText("In progress");
  await card.getByRole("link", { name: "Resume" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Session [AB] · / })).toBeVisible();
  return server;
}

const bench = (page: Page) => page.getByRole("region", { name: /^Barbell bench press/ });
const load = (page: Page, n: number) =>
  bench(page).getByRole("textbox", { name: `Load of set ${n}, lb` });

// The sets the session sent, by position.
const sent = (server: Awaited<ReturnType<typeof fakeServer>>) =>
  server.requests
    .flatMap((r) => r.changes)
    .filter((c): c is Extract<Change, { kind: "set"; field: "create" }> => {
      return c.kind === "set" && c.field === "create";
    });

test("a session's bench card says lb and logs 135 lb in two taps", async ({ page }) => {
  const server = await resume(page, "A");
  const header = bench(page).locator("[aria-hidden].grid").first();
  await expect(header).toContainText("lb");
  await expect(header).not.toContainText("kg");
  // Last time's 80 kg is 176 lb; the warm-ups come from the lb plates, whole pounds under it.
  await expect(load(page, 1)).toHaveValue("176");
  await expect(bench(page)).toContainText("last time 176 lb × 8");
  for (const n of [1, 2]) {
    const warm = await bench(page)
      .getByRole("textbox", { name: `Load of warm-up ${n}, lb` })
      .inputValue();
    expect(warm).toMatch(/^\d+$/);
    expect(Number(warm)).toBeLessThan(176);
    expect(Number(warm) % 5).toBe(0);
  }

  // Typed over the prefill, then ✓: 135 lb is 61.25 kg on the set grid.
  await load(page, 1).fill("135");
  await bench(page).getByRole("button", { name: "Log set 1" }).click();
  await expect(bench(page).getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await expect(load(page, 1)).toHaveValue("135");
  await expect.poll(() => sent(server).find((c) => c.position === 3)?.weightKg).toBe(61.25);

  // The next set, untouched: its 176 lb prefill sends the stored 80 kg, not 79.75.
  const skip = page.getByRole("button", { name: "Skip" });
  if (await skip.isVisible()) await skip.click();
  await expect(load(page, 2)).toHaveValue("176");
  await bench(page).getByRole("button", { name: "Log set 2" }).click();
  await expect(bench(page).getByRole("img", { name: "Set 2 logged" })).toBeVisible();
  await expect.poll(() => sent(server).find((c) => c.position === 4)?.weightKg).toBe(80);
  await expect(bench(page)).not.toContainText("kg");
});

test("the bench card fits a 360 px screen in lb", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await resume(page, "A");
  await expect(load(page, 1)).toHaveValue("176");
  const box = (await bench(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  // Each load cell shows its whole number.
  const cells = await bench(page)
    .getByRole("textbox", { name: /^Load of/ })
    .evaluateAll((inputs) =>
      inputs.map((i) => (i as HTMLInputElement).scrollWidth <= (i as HTMLInputElement).clientWidth),
    );
  expect(cells.every(Boolean)).toBe(true);
});

test("the exercise picker's last time says lb", async ({ page }) => {
  await resume(page, "B");
  const squat = page.getByRole("region", { name: /^Barbell full squat/ });
  await squat.getByRole("button", { name: "Replace" }).click();
  const sheet = page.getByRole("dialog", { name: /^Replace/ });
  await expect(sheet).toContainText("last time 220 lb × 12");
  await expect(sheet).not.toContainText("kg");
});

test("the past session's sets and volume say lb", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("belay.weightUnit", "lb"));
  await page.setViewportSize({ width: 390, height: 844 });
  await fakeServer(page, { changes: LAST_A });
  await page.goto(`/workouts/${LAST}`);
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
  await expect(page.locator(".launch")).toBeHidden();
  const benchSets = page.getByRole("region", { name: "Barbell bench press" });
  await expect(benchSets.getByRole("listitem")).toHaveText([
    /^1176 lb × 8/,
    /^2176 lb × 8/,
    /^3176 lb × 7/,
    /^4176 lb × 6/,
  ]);
  const volume = page.locator("main dl > div").filter({ hasText: "Volume" });
  const figure = new Intl.NumberFormat("en-US").format(Math.round(kgToLb(VOLUME_KG)));
  await expect(volume.locator("dd")).toHaveText(`${figure} lb`);
  await expect(volume.locator("dd span")).toHaveText("lb");
  await expect(page.locator("main")).not.toContainText("kg");
});

for (const theme of ["light", "dark"] as const) {
  test(`a session in lb has no axe violation, ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
    await resume(page, "A");
    await expect(load(page, 1)).toHaveValue("176");
    if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
    await expectNoAxeViolations(page);
  });
}
