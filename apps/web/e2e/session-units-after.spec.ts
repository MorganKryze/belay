import type { Change } from "@belay/shared/sync/schema";
import { kgFromLoad, kgToLb } from "@belay/shared/tools/units";
import { sessionByCode } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations } from "./axe";
import { fakeServer } from "./fake-server";

// The real clock throughout: the router reads it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

// Session A three days ago, the bench press at 80 kg × 8, 8, 7 (176 lb); then session A
// yesterday, at 85 kg × 8, 8 (187 lb): a record.
const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const DONE = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e02";
function session(id: string, daysAgo: number, loads: [number, number][]): Change[] {
  const day = Date.now() - daysAgo * 86_400_000;
  const at = (minutes: number) => new Date(day + minutes * 60_000).toISOString();
  return [
    {
      kind: "workout",
      id,
      field: "start",
      sessionCode: "A",
      plan: [...sessionByCode("A")!.slots],
      startedAt: at(0),
      at: at(0),
    },
    ...loads.map(([weightKg, reps], k): Change => ({
      kind: "set",
      id: `${id.slice(0, -2)}${daysAgo}${k}`,
      workoutId: id,
      field: "create",
      slotIndex: 0,
      position: 3 + k,
      exerciseId: "ds:0025",
      warmup: false,
      weightKg,
      reps,
      rir: 1,
      doneAt: at(5 + k * 3),
      at: at(5 + k * 3),
    })),
    { kind: "workout", id, field: "ended", value: at(60), at: at(60) },
  ];
}
const PAST = session(LAST, 3, [
  [80, 8],
  [80, 8],
  [80, 7],
]);
const BOTH = [
  ...PAST,
  ...session(DONE, 1, [
    [85, 8],
    [85, 8],
  ]),
];

async function inPounds(page: Page, changes: Change[], url: string) {
  await page.addInitScript(() => localStorage.setItem("belay.weightUnit", "lb"));
  const server = await fakeServer(page, { changes });
  await page.goto(url);
  await expect(page.locator(".launch")).toBeHidden();
  return server;
}

const openSummary = async (page: Page) => {
  await inPounds(page, BOTH, `/workout/summary/${DONE}`);
  await expect(page.getByRole("heading", { level: 1, name: "Session A · Push" })).toBeVisible();
};
const openEditor = async (page: Page) => {
  const server = await inPounds(page, PAST, `/workout/edit?id=${LAST}`);
  await expect(page.getByRole("textbox", { name: "Load of set 1, lb" })).toHaveValue("176");
  return server;
};

test("the summary's volume and record say lb", async ({ page }) => {
  await openSummary(page);
  const volume = page.locator("main dl > div").filter({ hasText: "Volume" });
  const figure = new Intl.NumberFormat("en-US").format(Math.round(kgToLb(85 * 16)));
  await expect(volume.locator("dd")).toHaveText(`${figure} lb`);
  await expect(page.locator("main")).toContainText("Record: Barbell bench press, 187 lb × 8");
  await expect(page.locator("main")).not.toContainText("kg");
});

test("editing a past session takes whole pounds", async ({ page }) => {
  const server = await openEditor(page);
  const header = page.locator("[aria-hidden].grid").first();
  await expect(header).toContainText("lb");
  await expect(header).not.toContainText("kg");
  await page.getByRole("textbox", { name: "Load of set 1, lb" }).fill("185");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page).toHaveURL(new RegExp(`/workouts/${LAST}$`));
  // Only the set typed over is written, in kg; the untouched 176 lb keep their 80 kg.
  await expect
    .poll(() =>
      server.requests
        .flatMap((r) => r.changes)
        .filter((c) => c.kind === "set" && c.field === "values"),
    )
    .toEqual([expect.objectContaining({ weightKg: kgFromLoad(185, "lb"), reps: 8 })]);
});

test("the exercise sheet says incrément 5 lb for a barbell", async ({ page }) => {
  await inPounds(page, [], "/exercises/ds:0025");
  await expect(page.locator("main")).toContainText("Barbell · steps of 5 lb");
});

test("the preview's last top set says lb", async ({ page }) => {
  await inPounds(page, PAST, "/workouts/session/A");
  const bench = page.getByRole("listitem").filter({ hasText: "Barbell bench press" }).first();
  await expect(bench).toContainText("176 lb × 8");
  await expect(bench).not.toContainText("kg");
});

for (const theme of ["light", "dark"] as const) {
  for (const [name, go] of [
    ["summary", openSummary],
    ["editor", openEditor],
  ] as const) {
    test(`the ${name} in lb has no axe violation, ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem("belay.theme", t), theme);
      await go(page);
      if (theme === "dark") await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
    });
  }
}
