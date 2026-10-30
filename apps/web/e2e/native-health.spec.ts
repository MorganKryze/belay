import { addDays, toISODate } from "@belay/shared/body/dates";
import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { expect, type Page, test } from "@playwright/test";
import { expectNoAxeViolations, settled } from "./axe";
import { ownerOf } from "../src/native/health-plan";
import { ADA, fakeServer } from "./fake-server";
import { addHealthSample, asIPhone, healthRequests, healthStore } from "./native";

// The real clock throughout: what goes to Health is dated against the time that passes, and every
// run is asynchronous, so the fake Health's state is polled, never read once.
test.use({ locale: "fr-FR" });

const A = sessionByCode("A", starterProgram)!;
const SESSION = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f01";
const SESSION_KEY = `belay-session-${SESSION}`;
const today = () => toISODate(new Date());
// 08:00 or 07:00 on this phone's day, in its own time zone (the browser's is the test's), and the
// same hour on a day further back.
const daysAgoAt = (days: number, hour: number) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour).getTime();
};
const todayAt = (hour: number) => daysAgoAt(0, hour);
// A weigh-in ten days ago, from before the setting goes on: it prefills the weigh-in sheet and
// makes « Envoyer l’historique » offer something.
const EARLIER = () => [{ date: addDays(today(), -10), weightKg: 80 }];

const iso = (t: number) => new Date(t).toISOString();
// Session A as another device sends it: started, one set, ended at `end`.
const finished = (start: number, end: number): Change[] => [
  {
    kind: "workout",
    id: SESSION,
    field: "start",
    sessionCode: "A",
    plan: [...A.slots],
    startedAt: iso(start),
    at: iso(start),
  },
  {
    kind: "set",
    id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7f11",
    workoutId: SESSION,
    field: "create",
    slotIndex: 0,
    position: 3,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg: 80,
    reps: 8,
    rir: 1,
    doneAt: iso(start + 60_000),
    at: iso(start + 60_000),
  },
  { kind: "workout", id: SESSION, field: "ended", value: iso(end), at: iso(end) },
];

type Health = NonNullable<Parameters<typeof asIPhone>[1]>["health"];

// The iPhone app signed in to an instance at the preview's own address, so the fake server's
// routes answer it there with no cross-origin rules in the way.
async function signedIn(page: Page, baseURL: string, health: Health = {}) {
  await asIPhone(page, { instance: baseURL, token: "a".repeat(43), health });
  return fakeServer(page, { rows: EARLIER() });
}

const healthSwitch = (page: Page) => page.getByRole("switch", { name: /^Séances et pesées/ });
const importSwitch = (page: Page) => page.getByRole("switch", { name: /^Importer les pesées/ });
const consent = (page: Page) =>
  page.getByRole("dialog", { name: "Importer tes pesées de Santé ?" });
const historyAction = (page: Page) =>
  page.getByRole("button", { name: /^Importer l’historique de Santé/ });

async function openHealth(page: Page) {
  await page.goto("/settings/health");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Apple Santé" })).toBeVisible();
}

// The setting turned on in the page; resolves once it shows on, with the time it went on.
async function turnOn(page: Page): Promise<number> {
  await healthSwitch(page).click();
  await expect(healthSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("À jour avec Santé")).toBeVisible();
  return Date.now();
}

async function openConsent(page: Page) {
  await importSwitch(page).click();
  await expect(consent(page)).toBeVisible();
  await settled(page);
}

// Accueil's weigh-in sheet, prefilled with the last weigh-in before anything is typed.
async function weighSheet(page: Page) {
  await page.goto("/");
  await expect(page.locator(".launch")).toBeHidden();
  await page.getByRole("button", { name: /^Pesée/ }).click();
  const sheet = page.getByRole("dialog", { name: "Pesée" });
  await expect(sheet.getByRole("textbox", { name: "Poids" })).toHaveValue(/^\d/);
  return sheet;
}

async function typeWeighIn(page: Page, kg: string) {
  const sheet = await weighSheet(page);
  await sheet.getByRole("textbox", { name: "Poids" }).fill(kg);
  await sheet.getByRole("button", { name: "Enregistrer" }).click();
  await expect(sheet).toBeHidden();
}

const weighingKey = (store: Record<string, unknown>) =>
  Object.keys(store).find((k) => k.startsWith("belay-weighing-"));

test("Réglages shows Apple Santé, Désactivé, and the page turns it on", async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL!);
  await page.goto("/settings");
  await expect(page.locator(".launch")).toBeHidden();
  const row = page.getByRole("link", { name: /^Apple Santé/ });
  await expect(page.getByText("Sur cet iPhone")).toBeVisible();
  await expect(row).toContainText("Désactivé");
  await row.click();
  await expect(page.getByRole("heading", { level: 1, name: "Apple Santé" })).toBeVisible();
  await expect(healthSwitch(page)).toHaveAttribute("aria-checked", "false");
  await turnOn(page);
  expect(await healthRequests(page)).toContainEqual({ op: "authorize", scope: "write" });
  await page.getByRole("link", { name: "Réglages" }).click();
  await expect(page.getByRole("link", { name: /^Apple Santé/ })).toContainText("Activé");
});

test("a session finished on another device is written once; a new end writes it again with a greater version; its removal removes it", async ({
  page,
  baseURL,
}) => {
  const server = await signedIn(page, baseURL!);
  await openHealth(page);
  const on = await turnOn(page);

  server.push(...finished(on - 45 * 60_000, on + 1000));
  await page.reload();
  await expect.poll(async () => Object.keys(await healthStore(page))).toEqual([SESSION_KEY]);
  const first = (await healthStore(page))[SESSION_KEY]!;
  expect(first).toMatchObject({ kind: "workout", id: SESSION, endedAt: on + 1000 });

  const later = on + 5 * 60_000;
  server.push({ kind: "workout", id: SESSION, field: "ended", value: iso(later), at: iso(later) });
  await page.reload();
  await expect.poll(async () => (await healthStore(page))[SESSION_KEY]?.endedAt).toBe(later);
  const second = await healthStore(page);
  expect(Object.keys(second)).toEqual([SESSION_KEY]);
  expect(second[SESSION_KEY]!.version as number).toBeGreaterThan(first.version as number);

  server.push({
    kind: "workout",
    id: SESSION,
    field: "removed",
    value: true,
    at: iso(later + 1000),
  });
  await page.reload();
  await expect.poll(async () => Object.keys(await healthStore(page))).toEqual([]);
});

test("a weigh-in goes to Health at 08:00 and its deletion removes it", async ({
  page,
  baseURL,
}) => {
  await signedIn(page, baseURL!);
  await openHealth(page);
  await turnOn(page);

  const before = Date.now();
  await typeWeighIn(page, "79,6");
  await expect.poll(async () => weighingKey(await healthStore(page))).toBeDefined();
  const store = await healthStore(page);
  const key = weighingKey(store)!;
  // Tagged with the account, as the native side builds it.
  expect(key).toBe(`belay-weighing-${ownerOf(ADA.id)}-${today()}`);
  const at = store[key]!.at as number;
  // 08:00 on its day, or the moment it was written when that is earlier: never in the future.
  if (before >= todayAt(8)) expect(at).toBe(todayAt(8));
  else expect(at).toBeGreaterThanOrEqual(before);
  expect(at).toBeLessThanOrEqual(Math.max(todayAt(8), Date.now()));
  expect(store[key]).toMatchObject({ kind: "weighing", date: today(), kg: 79.6 });

  const sheet = await weighSheet(page);
  await sheet.getByRole("button", { name: "Supprimer cette pesée" }).click();
  await expect(sheet).toBeHidden();
  await expect.poll(async () => weighingKey(await healthStore(page))).toBeUndefined();
});

test("the import's sheet names the host; Annuler leaves it off", async ({ page, baseURL }) => {
  await signedIn(page, baseURL!);
  await openHealth(page);
  await turnOn(page);
  await openConsent(page);
  await expect(consent(page)).toContainText(new URL(baseURL!).host);
  await consent(page).getByRole("button", { name: "Annuler" }).click();
  await expect(consent(page)).toBeHidden();
  await expect(importSwitch(page)).toHaveAttribute("aria-checked", "false");
  expect(await healthRequests(page)).not.toContainEqual({ op: "authorize", scope: "import" });
});

test("an import fills today's empty day and the server receives it", async ({ page, baseURL }) => {
  const server = await signedIn(page, baseURL!, {
    samples: [{ startedAt: todayAt(7), kg: 81.4 }],
  });
  await openHealth(page);
  await turnOn(page);
  await openConsent(page);
  await consent(page).getByRole("button", { name: "Importer" }).click();
  await expect(importSwitch(page)).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => server.rows.get(today())?.weightKg).toBe(81.4);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Pesée/ })).toContainText("81,4");
});

test("an import leaves a typed weigh-in alone", async ({ page, baseURL }) => {
  const server = await signedIn(page, baseURL!);
  await typeWeighIn(page, "79,6");
  await expect.poll(() => server.rows.get(today())?.weightKg).toBe(79.6);
  await addHealthSample(page, { startedAt: todayAt(7), kg: 81.4 });
  await openHealth(page);
  await turnOn(page);
  await openConsent(page);
  await consent(page).getByRole("button", { name: "Importer" }).click();
  await expect
    .poll(async () => (await healthRequests(page)).some((r) => r.op === "readWeighings"))
    .toBe(true);
  // The reading was handed over; give the import its transaction, then nothing has changed.
  await page.waitForTimeout(500);
  expect(server.rows.get(today())?.weightKg).toBe(79.6);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /^Pesée/ })).toContainText("79,6");
});

test("the history brings a weigh-in dated 30 days back and leaves a typed one alone", async ({
  page,
  baseURL,
}) => {
  const server = await signedIn(page, baseURL!, {
    samples: [
      { startedAt: daysAgoAt(30, 7), kg: 78.4 },
      { startedAt: daysAgoAt(10, 7), kg: 81.4 },
    ],
  });
  await openHealth(page);
  await turnOn(page);
  await openConsent(page);
  await consent(page).getByRole("button", { name: "Importer" }).click();
  await historyAction(page).click();
  await expect(page.getByText("Historique importé")).toBeVisible();
  await expect.poll(() => server.rows.get(addDays(today(), -30))?.weightKg).toBe(78.4);
  expect(server.rows.get(addDays(today(), -10))?.weightKg).toBe(80);
  // The sheet prefills the last weigh-in: the typed day, as it was.
  const sheet = await weighSheet(page);
  await expect(sheet.getByRole("textbox", { name: "Poids" })).toHaveValue(/^80\b/);
});

test("a browser shows no Apple Santé and the page is not found", async ({ page }) => {
  await fakeServer(page);
  await page.goto("/settings");
  await expect(page.locator(".launch")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Réglages" })).toBeVisible();
  await expect(page.getByText("Sur cet iPhone")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^Apple Santé/ })).toHaveCount(0);
  await page.goto("/settings/health");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test(`the Apple Health page has no axe violation, ${scheme}`, async ({ page, baseURL }) => {
      await signedIn(page, baseURL!);
      await openHealth(page);
      await turnOn(page);
      await openConsent(page);
      await consent(page).getByRole("button", { name: "Importer" }).click();
      await expect(consent(page)).toBeHidden();
      await expect(importSwitch(page)).toHaveAttribute("aria-checked", "true");
      await expect(
        page.getByRole("button", { name: /^Envoyer l’historique à Santé/ }),
      ).toBeVisible();
      await expect(historyAction(page)).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test(`the import sheet has no axe violation, ${scheme}`, async ({ page, baseURL }) => {
      await signedIn(page, baseURL!);
      await openHealth(page);
      await turnOn(page);
      await openConsent(page);
      await expectNoAxeViolations(page);
    });
  });
}
