import type { Change } from "@belay/shared/sync/schema";
import type { Slot } from "@belay/shared/training/workout";
import { expect, type Page, test } from "@playwright/test";
import { ADA, fakeServer } from "./fake-server";

// A session done keeps its session's name of that day: « Haut lourd » renamed « Haut du corps »
// on a computer leaves the session started under the old name as it was, while a session done
// before names were kept follows the rename.
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", viewport: { width: 1280, height: 900 } });

const id = (n: number) => `0199c3a2-7b1e-7cc0-8f3e-${n.toString(16).padStart(12, "0")}`;
const T0 = new Date(Date.now() - 20 * 86_400_000).toISOString();
const DAY = (n: number, minutes = 0) =>
  new Date(Date.now() - n * 86_400_000 + minutes * 60_000).toISOString();
const FORCE = id(0x10);
const HAUT = id(0x11);
const SCHEDULE = { mode: "rotation" as const, days: Array<null>(7).fill(null) };
const slot: Slot = {
  exerciseId: "ds:0025",
  sets: 3,
  repRange: [8, 12],
  rirTarget: [1, 2],
  restSec: 90,
  warmupSets: 0,
  isMain: false,
  groupKey: null,
};
const session = (sessionId: string, name: string, position: number, slotId: string): Change[] => [
  {
    kind: "programSession",
    id: sessionId,
    field: "create",
    name,
    programId: FORCE,
    position,
    at: T0,
  },
  {
    kind: "programSlot",
    id: slotId,
    field: "create",
    sessionId,
    position: 0,
    rule: null,
    ...slot,
    at: T0,
  },
];
// A session A done 3 days ago that kept « Haut lourd », and one done 5 days ago, before names
// were kept (an older phone's start).
const done = (workout: string, days: number, kept: boolean): Change[] => [
  {
    kind: "workout",
    id: workout,
    field: "start",
    sessionCode: "A",
    sessionId: HAUT,
    ...(kept && { sessionName: "Haut lourd" }),
    plan: [slot],
    startedAt: DAY(days),
    at: DAY(days),
  },
  { kind: "workout", id: workout, field: "ended", value: DAY(days, 50), at: DAY(days, 50) },
];
const FORCE_PROGRAM: Change[] = [
  { kind: "program", id: FORCE, field: "create", name: "Force", schedule: SCHEDULE, at: T0 },
  { kind: "activeProgram", programId: FORCE, at: T0 },
  ...session(HAUT, "Haut lourd", 0, id(0x101)),
  ...session(id(0x12), "Bas lourd", 1, id(0x102)),
  ...done(id(0x201), 3, true),
  ...done(id(0x202), 5, false),
];

async function queued(page: Page): Promise<Change[]> {
  return page.evaluate(
    (account) =>
      new Promise<Change[]>((resolve, reject) => {
        const open = indexedDB.open(`belay.${account}`);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction("outbox").objectStore("outbox").getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve((all.result as { change: Change }[]).map((e) => e.change));
          };
        };
      }),
    ADA.id,
  );
}

async function rename(page: Page, from: string, to: string) {
  await page.goto("/workouts/program");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(`Séance A · ${from}`);
  await page.getByRole("button", { name: "Renommer la séance" }).click();
  const field = page.getByRole("textbox", { name: "Nom de la séance" });
  await expect(field).toHaveValue(from);
  await field.fill(to);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(`Séance A · ${to}`);
}

test("a rename leaves a session done under its name of that day; one done before follows it (HN5)", async ({
  page,
}) => {
  await fakeServer(page, { changes: FORCE_PROGRAM });
  await rename(page, "Haut lourd", "Haut du corps");
  await page.goto("/workouts?tab=history");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByText("Séance A · Haut lourd", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Séance A · Haut du corps", { exact: true })).toHaveCount(1);
});

test("a session started on this device keeps the name its session held at the start (HN1)", async ({
  page,
}) => {
  const server = await fakeServer(page, { changes: FORCE_PROGRAM.slice(0, 6) });
  // The program arrives with the first sync; the start waits for it.
  await page.goto("/workouts/program");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText("Séance A · Haut lourd");
  await page.goto("/workout?start=A");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Séance A · Haut lourd" }),
  ).toBeVisible();
  // The heading can show before the start is written: wait for it, queued or sent.
  const start = async () =>
    [...server.requests.flatMap((r) => r.changes), ...(await queued(page))].find(
      (c) => c.kind === "workout" && c.field === "start",
    );
  await expect.poll(start).toMatchObject({ sessionId: HAUT, sessionName: "Haut lourd" });
  await rename(page, "Haut lourd", "Haut du corps");
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByText("Séance A · Haut lourd").first()).toBeVisible();
  await expect(page.getByText("Séance A · Haut du corps")).toHaveCount(0);
});
