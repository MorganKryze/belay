import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, test } from "@playwright/test";
import { fakeServer } from "./fake-server";

// The real clock throughout: the router reads it.
test.use({ locale: "en-US", timezoneId: "Europe/Paris" });

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());

// Session A three days ago, the bench press at 80 kg × 8 (176 lb), and session A open since five
// minutes ago on top of it.
const DAY = new Date(Date.now() - 3 * 86_400_000);
const at = (minutes: number) => new Date(DAY.getTime() + minutes * 60_000).toISOString();
const LAST = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
const NOW = new Date(Date.now() - 5 * 60_000).toISOString();
const plan = [...sessionByCode("A", starterProgram)!.slots];
const CHANGES: Change[] = [
  {
    kind: "workout",
    id: LAST,
    field: "start",
    sessionCode: "A",
    plan,
    startedAt: at(0),
    at: at(0),
  },
  {
    kind: "set",
    id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e30",
    workoutId: LAST,
    field: "create",
    slotIndex: 0,
    position: 3,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg: 80,
    reps: 8,
    rir: 1,
    doneAt: at(5),
    at: at(5),
  },
  { kind: "workout", id: LAST, field: "ended", value: at(60), at: at(60) },
  {
    kind: "workout",
    id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01",
    field: "start",
    sessionCode: "A",
    plan,
    startedAt: NOW,
    at: NOW,
  },
];

test("a unit switched in Settings shows on Body and in the session without a reload, the kg kept", async ({
  page,
}) => {
  // Today's weigh-in, 80.4 kg: 177.25 lb.
  const server = await fakeServer(page, {
    rows: [{ date: today(), weightKg: 80.4 }],
    changes: CHANGES,
  });
  await page.goto("/settings");
  await expect(page.locator(".launch")).toBeHidden();
  const unitRow = page.getByRole("combobox", { name: /^Weight unit · / });
  await expect(unitRow).toHaveAccessibleName("Weight unit · Kilograms (kg)");
  await unitRow.click();
  await page.getByRole("option", { name: "Pounds (lb)" }).click();
  await expect(unitRow).toHaveAccessibleName("Weight unit · Pounds (lb)");

  // Back Home, then Body from the menu: the same page, never reloaded.
  await page.evaluate(() => Object.assign(window, { notReloaded: true }));
  const nav = page.getByRole("navigation", { name: "Main" });
  await page.getByRole("link", { name: "Home" }).click();
  await nav.getByRole("link", { name: "Body" }).click();
  const history = page.getByRole("region", { name: "History" });
  await expect(history).toContainText("177.25 lb");
  await expect(history).not.toContainText("kg");

  // Then the open session, from Home's card.
  await nav.getByRole("link", { name: "Home" }).click();
  const card = page.getByRole("region", { name: /^Session A · / });
  await card.getByRole("link", { name: "Resume" }).click();
  const bench = page.getByRole("region", { name: /^Barbell bench press/ });
  const load = bench.getByRole("textbox", { name: "Load of set 1, lb" });
  await expect(load).toHaveValue("176");
  await expect(bench).toContainText("last time 176 lb × 8");
  expect(await page.evaluate(() => "notReloaded" in window)).toBe(true);

  // Logged untouched, the 176 lb prefill sends the stored 80 kg; the weigh-in stays 80.4 kg.
  await bench.getByRole("button", { name: "Log set 1" }).click();
  await expect(bench.getByRole("img", { name: "Set 1 logged" })).toBeVisible();
  await expect
    .poll(() =>
      server.requests
        .flatMap((r) => r.changes)
        .find((c) => c.kind === "set" && c.field === "create" && c.workoutId !== LAST),
    )
    .toMatchObject({ weightKg: 80 });
  expect(server.rows.get(today())?.weightKg).toBe(80.4);
  expect(server.requests.flatMap((r) => r.changes).some((c) => c.kind === "weight")).toBe(false);
});
