import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { openAccountDb } from "../sync/db";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";
import { session } from "../test/workout-fixtures";

// Capacitor's proxy answers every property, `then` included: a promise resolved with it would
// never settle. The mock does the same, so a test fails if the plugin is ever handed to one.
const native = vi.hoisted(() => ({
  health: vi.fn(),
  get then(): never {
    throw new Error('"BelayNative.then()" is not implemented on ios');
  },
}));
vi.mock("@/native/plugin", () => ({ BelayNative: native }));
// The shell's link with Health keeps its own tests; here the page alone talks to the mock.
vi.mock("@/native/rest-alert", () => ({ NativeRestAlert: () => null }));

import {
  askImportHistory,
  type HealthHistoryAccess,
  healthProgress,
  HISTORY_SINCE,
  markHistorySent,
  readHealth,
  setHealthOn,
  setHealthRunner,
  setImportOn,
} from "../native/health";
import { importWeighings } from "../native/health-import";

type Access = "allowed" | "denied" | "undetermined";
type Answer = {
  available: boolean;
  workouts: Access;
  weighings: Access;
  history?: HealthHistoryAccess;
};
const status = (workouts: Access, weighings: Access, available = true): Answer => ({
  available,
  workouts,
  weighings,
});
// Android's status, which also says whether older weigh-ins can be read.
const withHistory = (history: HealthHistoryAccess): Answer => ({
  ...status("allowed", "allowed"),
  history,
});
const ORIGIN = "https://belay.example.org";
const IDLE = { sending: null, pending: 0 };

// Radix calls scrolling APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {};
});

let run: ReturnType<typeof vi.fn<() => void>>;
let api: ReturnType<typeof fakeApi>;
beforeEach(async () => {
  indexedDB = new IDBFactory();
  native.health.mockReset();
  run = vi.fn<() => void>();
  setHealthRunner(run);
  healthProgress.set(IDLE);
  await i18n.changeLanguage("fr");
});
afterEach(async () => {
  cleanup();
  setHealthRunner(null);
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

// The iPhone app signed in to its instance: requests go to the stored address, answered by the
// same stand-in server as in a browser. `answers` is what each `health` call resolves with, in
// turn; the last one stays.
function onIPhone(...answers: Answer[]) {
  onPhone("ios", answers);
}
// The same on Android: the page then names Health Connect and the phone.
function onAndroid(...answers: Answer[]) {
  onPhone("android", answers);
}
function onPhone(platform: "ios" | "android", answers: Answer[]) {
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => platform,
  };
  localStorage.setItem("belay.instance", ORIGIN);
  api = fakeApi({ me: ADA });
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    api.fetchMock(String(input).replace(ORIGIN, ""), init),
  );
  let i = 0;
  native.health.mockImplementation(async () => answers[Math.min(i++, answers.length - 1)]);
}
const calls = (op: string) =>
  native.health.mock.calls.filter(([r]) => (r as { op: string }).op === op);
const mainSwitch = () => screen.findByRole("switch", { name: /^Séances et pesées/ });
const importSwitch = () => screen.findByRole("switch", { name: /^Importer les pesées/ });
const stateNow = async () => {
  const db = await openAccountDb(ADA.id);
  const state = await readHealth(db);
  db.close();
  return state;
};
const settingsNow = async () => (await stateNow()).settings;
async function turnedOn() {
  const db = await openAccountDb(ADA.id);
  await setHealthOn(db, true, Date.now());
  db.close();
}
async function importTurnedOn(at = Date.now()) {
  await turnedOn();
  const db = await openAccountDb(ADA.id);
  await setImportOn(db, false, at);
  await setImportOn(db, true, at);
  db.close();
}
async function historyAsked(windowed = false) {
  await importTurnedOn();
  const db = await openAccountDb(ADA.id);
  await askImportHistory(db, windowed);
  db.close();
}
// The read the shell runs after a landed sync, finding nothing new.
async function historyRead() {
  const db = await openAccountDb(ADA.id);
  await importWeighings(db, [], "H1", new Date(), {
    anchor: null,
    since: HISTORY_SINCE,
  });
  db.close();
}
async function historyDone(windowed = false) {
  await historyAsked(windowed);
  await historyRead();
}
const fromHealth = () => screen.findByRole("region", { name: "Depuis Santé" });
const fromConnect = () => screen.findByRole("region", { name: "Depuis Santé Connect" });
const syncStarted = () => waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
// The shell's refresh after a read: here the page comes back to the foreground, which the state's
// query follows.
const backInForeground = () =>
  act(() => void document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));

describe("Réglages › Apple Santé, where it shows", () => {
  it("in a browser Réglages has no Sur cet iPhone group and the page is not found", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await screen.findByRole("region", { name: "Suivi" });
    expect(screen.queryByRole("region", { name: "Sur cet iPhone" })).toBeNull();
    cleanup();
    renderRoute("/settings/health");
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeTruthy();
    expect(native.health).not.toHaveBeenCalled();
  });

  it("on an iPhone without Health data neither shows", async () => {
    onIPhone(status("undetermined", "undetermined", false));
    renderRoute("/settings");
    await screen.findByRole("region", { name: "Suivi" });
    await waitFor(() => expect(calls("status")).not.toHaveLength(0));
    expect(screen.queryByRole("region", { name: "Sur cet iPhone" })).toBeNull();
    cleanup();
    renderRoute("/settings/health");
    expect(await screen.findByRole("heading", { name: "Page introuvable" })).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("Réglages shows Apple Santé, Désactivé, after Suivi, and never asks iOS for access", async () => {
    onIPhone(status("undetermined", "undetermined"));
    renderRoute("/settings");
    const group = await screen.findByRole("region", { name: "Sur cet iPhone" });
    const tracking = screen.getByRole("region", { name: "Suivi" });
    expect(tracking.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const row = await within(group).findByRole("link", { name: /Apple Santé/ });
    expect(row.getAttribute("href")).toBe("/settings/health");
    await within(row).findByText("Désactivé");
    expect(calls("authorize")).toHaveLength(0);
  });

  it("Réglages says Activé once on, and Accès refusé whenever iOS refuses both writes", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings");
    const group = await screen.findByRole("region", { name: "Sur cet iPhone" });
    await within(group).findByText("Activé");
    cleanup();
    native.health.mockResolvedValue(status("denied", "denied"));
    renderRoute("/settings");
    const again = await screen.findByRole("region", { name: "Sur cet iPhone" });
    await within(again).findByText("Accès refusé");
  });
});

describe("Réglages › Apple Santé, the setting", () => {
  it("shows the setting off with its footers, the switches named by their labels", async () => {
    onIPhone(status("undetermined", "undetermined"));
    renderRoute("/settings/health");
    expect(await screen.findByRole("heading", { level: 1, name: "Apple Santé" })).toBeTruthy();
    const main = await mainSwitch();
    expect(main.getAttribute("aria-checked")).toBe("false");
    expect(main.textContent).toContain("Envoyées à Santé dès qu’elles sont enregistrées");
    expect(screen.getByText(/ajoute tes séances terminées et tes pesées/)).toBeTruthy();
    expect(screen.getByText(/Désactiver ne retire rien de Santé/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Vers Santé" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Depuis Santé" })).toBeNull();
    expect(calls("authorize")).toHaveLength(0);
  });

  it("turning the setting on asks iOS, keeps it on and asks for a run", async () => {
    onIPhone(status("undetermined", "undetermined"), status("allowed", "allowed"));
    renderRoute("/settings/health");
    fireEvent.click(await mainSwitch());
    await waitFor(async () => expect((await settingsNow()).on).toBe(true));
    expect(calls("authorize")).toEqual([[{ op: "authorize", scope: "write" }]]);
    await waitFor(async () =>
      expect((await mainSwitch()).getAttribute("aria-checked")).toBe("true"),
    );
    expect(run).toHaveBeenCalled();
    expect(await screen.findByRole("region", { name: "Vers Santé" })).toBeTruthy();
    expect(await screen.findByText("À jour avec Santé")).toBeTruthy();
  });

  it("turning it off writes it off", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings/health");
    const main = await mainSwitch();
    await waitFor(() => expect(main.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(main);
    await waitFor(async () => expect((await settingsNow()).on).toBe(false));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Vers Santé" })).toBeNull());
    expect(calls("authorize")).toHaveLength(0);
  });

  it("both writes refused: it stays off, says Accès refusé with the help, and the switch still answers", async () => {
    onIPhone(status("undetermined", "undetermined"), status("denied", "denied"));
    renderRoute("/settings/health");
    const main = await mainSwitch();
    fireEvent.click(main);
    expect(await screen.findByText("Accès refusé")).toBeTruthy();
    expect(screen.getByText("Santé n’autorise pas Belay à écrire.")).toBeTruthy();
    expect(
      screen.getByText(/Autorise-le dans l’app Santé › ta photo › Confidentialité › Apps › Belay/),
    ).toBeTruthy();
    expect(main.getAttribute("aria-checked")).toBe("false");
    expect((await settingsNow()).on).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect((main as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(main);
    await waitFor(() => expect(calls("authorize")).toHaveLength(2));
  });

  it("a call iOS rejects leaves it off and says nothing new", async () => {
    onIPhone(status("undetermined", "undetermined"));
    renderRoute("/settings/health");
    const main = await mainSwitch();
    native.health.mockRejectedValueOnce(new Error("Missing entitlement"));
    fireEvent.click(main);
    await waitFor(() => expect(calls("authorize")).toHaveLength(1));
    await act(async () => {});
    expect(main.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByText("Accès refusé")).toBeNull();
    expect((await settingsNow()).on).toBe(false);
  });

  it("the status is asked again when the app comes back, and Accès refusé clears itself", async () => {
    onIPhone(status("denied", "denied"));
    renderRoute("/settings/health");
    expect(await screen.findByText("Accès refusé")).toBeTruthy();
    native.health.mockResolvedValue(status("allowed", "allowed"));
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(screen.queryByText("Accès refusé")).toBeNull());
    expect(calls("status").length).toBeGreaterThanOrEqual(2);
  });
});

describe("Réglages › Apple Santé, what goes to Health", () => {
  it("one refused: only the other type is said to be sent", async () => {
    onIPhone(status("allowed", "denied"));
    await turnedOn();
    renderRoute("/settings/health");
    const to = await screen.findByRole("region", { name: "Vers Santé" });
    const live = await within(to).findByRole("status");
    await within(live).findByText("Santé refuse les pesées");
    expect(within(live).getByText("Seules les séances sont envoyées.")).toBeTruthy();
  });

  it("n éléments en attente when Health was not available", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    healthProgress.set({ sending: null, pending: 3 });
    renderRoute("/settings/health");
    const live = await within(await screen.findByRole("region", { name: "Vers Santé" })).findByRole(
      "status",
    );
    await within(live).findByText("3 éléments en attente");
    expect(
      within(live).getByText(
        "Santé n’était pas disponible. Nouvel essai à la prochaine ouverture.",
      ),
    ).toBeTruthy();
  });

  it("the offer names only what there is to send", async () => {
    onIPhone(status("allowed", "allowed"));
    await seed(ADA.id, [weight("2026-09-01", 80.2)]);
    await turnedOn();
    renderRoute("/settings/health");
    const offer = await screen.findByRole("button", { name: /Envoyer l’historique à Santé/ });
    expect(offer.textContent).toContain(
      "Ta 1 pesée d’avant l’activation. Rien n’est envoyé en double.",
    );
  });

  it("the history offers the counts, then shows Envoi… n sur N, then Historique envoyé", async () => {
    onIPhone(status("allowed", "allowed"));
    await seed(ADA.id, [
      weight("2026-09-01", 80.2),
      weight("2026-09-02", 80),
      ...session(1, "B", new Date(2026, 8, 3, 18), 58, [[0, 3, 100, 5, 2]]),
    ]);
    await turnedOn();
    renderRoute("/settings/health");
    const offer = await screen.findByRole("button", { name: /Envoyer l’historique à Santé/ });
    expect(offer.textContent).toContain(
      "Tes 1 séance et 2 pesées d’avant l’activation. Rien n’est envoyé en double.",
    );
    fireEvent.click(offer);
    await waitFor(async () => expect((await settingsNow()).history).toBe("asked"));
    expect(run).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Envoyer l’historique/ })).toBeNull(),
    );

    act(() => healthProgress.set({ sending: { done: 0, total: 3 }, pending: 0 }));
    const to = screen.getByRole("region", { name: "Vers Santé" });
    const live = within(to).getByRole("status");
    expect(live.textContent).toBe("Envoi… 0 sur 3");
    act(() => healthProgress.set({ sending: { done: 2, total: 3 }, pending: 0 }));
    expect(within(to).getByText("Envoi… 2 sur 3")).toBeTruthy();
    const bar = within(to).getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("2");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    // Polite at its start and its end only: the region empties without a word, and reads no step.
    expect(live.textContent).toBe("");
    expect(within(to).queryByText("À jour avec Santé")).toBeNull();

    // The run ends with nothing pending: the region says the status again.
    act(() => healthProgress.set(IDLE));
    await waitFor(() => expect(within(to).getByRole("status").textContent).toContain("À jour"));
    const db = await openAccountDb(ADA.id);
    await markHistorySent(db, (await readHealth(db)).settings.turnedOnAt);
    db.close();
    cleanup();
    renderRoute("/settings/health");
    expect(await screen.findByText("Historique envoyé")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Envoyer l’historique/ })).toBeNull();
  });

  it("the focus stays in the group when « Envoyer l’historique » goes", async () => {
    onIPhone(status("allowed", "allowed"));
    await seed(ADA.id, [weight("2026-09-01", 80.2)]);
    await turnedOn();
    renderRoute("/settings/health");
    const offer = await screen.findByRole("button", { name: /Envoyer l’historique à Santé/ });
    offer.focus();
    fireEvent.click(offer);
    await waitFor(() => expect(offer.isConnected).toBe(false));
    const to = screen.getByRole("region", { name: "Vers Santé" });
    expect(document.activeElement).toBe(within(to).getByRole("status"));
  });
});

describe("Réglages › Apple Santé, weigh-ins from Health", () => {
  it("the import's sheet names the instance's host; Annuler leaves it off and gives the switch its focus back", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings/health");
    const from = await screen.findByRole("region", { name: "Depuis Santé" });
    const toggle = await importSwitch();
    expect(from.contains(toggle)).toBe(true);
    expect(screen.queryByText(/Si aucune pesée n’arrive/)).toBeNull();
    act(() => toggle.focus());
    fireEvent.click(toggle);
    const sheet = await screen.findByRole("dialog", {
      name: "Importer tes pesées de Santé\u202f?",
    });
    const host = within(sheet).getByText("belay.example.org");
    expect(host.tagName).toBe("STRONG");
    expect(sheet.textContent).toContain("seront ajoutées à Belay et synchronisées avec");
    const cancel = within(sheet).getByRole("button", { name: "Annuler" });
    expect(document.activeElement).toBe(cancel);
    expect(within(sheet).queryByRole("button", { name: /Supprimer|Désactiver/ })).toBeNull();
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(toggle));
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(calls("authorize")).toHaveLength(0);
    expect((await settingsNow()).importOn).toBe(false);
  });

  it("Importer asks to read weight, turns the import on and syncs", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings/health");
    fireEvent.click(await importSwitch());
    const sheet = await screen.findByRole("dialog");
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
    const before = api.requests.length;
    fireEvent.click(within(sheet).getByRole("button", { name: "Importer" }));
    await waitFor(async () => expect((await settingsNow()).importOn).toBe(true));
    expect(calls("authorize")).toEqual([[{ op: "authorize", scope: "import" }]]);
    await waitFor(async () =>
      expect((await importSwitch()).getAttribute("aria-checked")).toBe("true"),
    );
    expect(await screen.findByText(/Si aucune pesée n’arrive, vérifie que Belay/)).toBeTruthy();
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
  });

  it("the import's permission answer takes « Accès refusé » away at once", async () => {
    onIPhone(status("denied", "denied"));
    native.health.mockImplementation(async ({ op }: { op: string }) =>
      status(op === "authorize" ? "allowed" : "denied", op === "authorize" ? "allowed" : "denied"),
    );
    await turnedOn();
    renderRoute("/settings/health");
    await screen.findByText("Accès refusé");
    fireEvent.click(await importSwitch());
    fireEvent.click(await screen.findByRole("button", { name: "Importer" }));
    await waitFor(() => expect(screen.queryByText("Accès refusé")).toBeNull());
  });

  it("the import turned off writes it off without asking iOS", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    const db = await openAccountDb(ADA.id);
    await setImportOn(db, true, Date.now());
    db.close();
    renderRoute("/settings/health");
    const toggle = await importSwitch();
    await waitFor(() => expect(toggle.getAttribute("aria-checked")).toBe("true"));
    fireEvent.click(toggle);
    await waitFor(async () => expect((await settingsNow()).importOn).toBe(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls("authorize")).toHaveLength(0);
  });
});

describe("Réglages › Apple Santé, the weigh-in history", () => {
  it("the import switch says it takes weigh-ins dated from the day it is turned on", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings/health");
    expect((await importSwitch()).textContent).toContain(
      "Celles d’une balance connectée ou saisies dans Santé, datées du jour de l’activation ou après",
    );
  });

  it("the consent sheet says today or later and that older ones come from this page", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings/health");
    fireEvent.click(await importSwitch());
    const sheet = await screen.findByRole("dialog");
    expect(sheet.textContent).toContain(
      "Les pesées que Santé reçoit d’autres apps et appareils, datées d’aujourd’hui ou après, seront ajoutées à Belay et synchronisées avec belay.example.org.",
    );
    expect(sheet.textContent).toContain(
      "Tes pesées plus anciennes pourront ensuite être importées depuis cette page.",
    );
  });

  it("with the import on, « Importer l’historique de Santé » names the import's day", async () => {
    onIPhone(status("allowed", "allowed"));
    await importTurnedOn(new Date(new Date().getFullYear(), 0, 15, 9).getTime());
    renderRoute("/settings/health");
    const action = await screen.findByRole("button", { name: /^Importer l’historique de Santé/ });
    expect((await fromHealth()).contains(action)).toBe(true);
    expect(action.textContent).toContain(
      "Tes pesées datées d’avant le 15 janvier. Une pesée déjà dans Belay n’est jamais remplacée.",
    );
    cleanup();
    await importTurnedOn(new Date(2025, 9, 29, 9).getTime());
    renderRoute("/settings/health");
    expect(
      (await screen.findByRole("button", { name: /^Importer l’historique de Santé/ })).textContent,
    ).toContain("Tes pesées datées d’avant le 29 octobre 2025.");
  });

  it("the import off offers no history", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings/health");
    await importSwitch();
    expect(screen.queryByRole("button", { name: /^Importer l’historique/ })).toBeNull();
  });

  it("tapping it asks the history, starts a sync, and shows « Import de l’historique… »", async () => {
    onIPhone(status("allowed", "allowed"));
    await importTurnedOn();
    renderRoute("/settings/health");
    const action = await screen.findByRole("button", { name: /^Importer l’historique de Santé/ });
    await syncStarted();
    const before = api.requests.length;
    fireEvent.click(action);
    await waitFor(async () => expect((await settingsNow()).importSince).toBe(HISTORY_SINCE));
    const from = await fromHealth();
    await within(from).findByText("Import de l’historique…");
    expect(
      within(within(from).getByRole("status")).getByText(/Import de l’historique/),
    ).toBeTruthy();
    expect(within(from).queryByRole("progressbar")).toBeNull();
    expect(within(from).queryByRole("button")).toBeNull();
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
    expect(calls("authorize")).toHaveLength(0);
    expect((await stateNow()).imported.historyWindowed).toBeUndefined();
  });

  it("the focus stays on the live region from the tap to the end", async () => {
    onIPhone(status("allowed", "allowed"));
    await importTurnedOn();
    renderRoute("/settings/health");
    const action = await screen.findByRole("button", { name: /^Importer l’historique de Santé/ });
    const live = within(await fromHealth()).getByRole("status");
    action.focus();
    fireEvent.click(action);
    await within(live).findByText("Import de l’historique…");
    expect(document.activeElement).toBe(live);
    await historyRead();
    backInForeground();
    await within(live).findByText("Historique importé");
    expect(document.activeElement).toBe(live);
  });

  it("a history asked and not done shows the running row when the page opens again", async () => {
    onIPhone(status("allowed", "allowed"));
    await historyAsked();
    renderRoute("/settings/health");
    const from = await fromHealth();
    await within(from).findByText("Import de l’historique…");
    expect(within(from).queryByRole("button")).toBeNull();
  });

  it("the same live region says the start and the end", async () => {
    onIPhone(status("allowed", "allowed"));
    await importTurnedOn();
    renderRoute("/settings/health");
    const action = await screen.findByRole("button", { name: /^Importer l’historique de Santé/ });
    const live = within(await fromHealth()).getByRole("status");
    expect(live.textContent).toBe("");
    fireEvent.click(action);
    await within(live).findByText("Import de l’historique…");
    await historyRead();
    backInForeground();
    await within(live).findByText("Historique importé");
  });

  it("a done history shows « Historique importé » and no action", async () => {
    onIPhone(status("allowed", "allowed"));
    await historyDone();
    renderRoute("/settings/health");
    const from = await fromHealth();
    await within(from).findByText("Historique importé");
    expect(within(from).queryByRole("button")).toBeNull();
    expect(within(from).queryByText(/Santé Connect/)).toBeNull();
  });

  it("turned off and on, the action is offered again", async () => {
    onIPhone(status("allowed", "allowed"));
    await historyDone();
    renderRoute("/settings/health");
    await screen.findByText("Historique importé");
    fireEvent.click(await importSwitch());
    await waitFor(async () => expect((await settingsNow()).importOn).toBe(false));
    await waitFor(() => expect(screen.queryByText("Historique importé")).toBeNull());
    fireEvent.click(await importSwitch());
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: "Importer" }));
    expect(
      await screen.findByRole("button", { name: /^Importer l’historique de Santé/ }),
    ).toBeTruthy();
    expect(screen.queryByText("Historique importé")).toBeNull();
  });
});

describe("Réglages › Santé Connect, on Android", () => {
  it("on Android Settings says Sur ce téléphone", async () => {
    onAndroid(status("undetermined", "undetermined"));
    renderRoute("/settings");
    const group = await screen.findByRole("region", { name: "Sur ce téléphone" });
    const row = await within(group).findByRole("link", { name: /^Santé Connect/ });
    await within(row).findByText("Désactivé");
    expect(screen.queryByText(/iPhone|Apple/)).toBeNull();
  });

  it("on Android the page says Santé Connect", async () => {
    onAndroid(status("allowed", "allowed"));
    await seed(ADA.id, [weight("2026-09-01", 80.2)]);
    await turnedOn();
    const db = await openAccountDb(ADA.id);
    await setImportOn(db, true, Date.now());
    db.close();
    renderRoute("/settings/health");
    expect(await screen.findByRole("heading", { level: 1, name: "Santé Connect" })).toBeTruthy();
    expect(
      screen.getByText(
        "Belay ajoute tes séances terminées et tes pesées à Santé Connect sur ce téléphone.",
      ),
    ).toBeTruthy();
    expect((await mainSwitch()).textContent).toContain(
      "Envoyées à Santé Connect dès qu’elles sont enregistrées",
    );
    const to = await screen.findByRole("region", { name: "Vers Santé Connect" });
    await within(to).findByText("À jour avec Santé Connect");
    expect(
      await within(to).findByRole("button", { name: /^Envoyer l’historique à Santé Connect/ }),
    ).toBeTruthy();
    const from = screen.getByRole("region", { name: "Depuis Santé Connect" });
    expect(within(from).getByRole("switch").textContent).toContain(
      "Celles d’une balance connectée ou d’une autre app",
    );
    expect(
      await within(from).findByText(
        "Si aucune pesée n’arrive, vérifie que Belay peut lire le poids dans les réglages de Santé Connect › Autorisations des applications › Belay.",
      ),
    ).toBeTruthy();
    // The matcher reads the narrow no-break space before « : » as a plain one.
    expect(
      screen.getByText(
        "Les séries, les charges et les répétitions restent dans Belay : Santé Connect n’a pas de place pour elles.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Désactiver ne retire rien de Santé Connect : ce qui y est déjà se supprime dans Santé Connect.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/iPhone|Apple|l’app Santé/)).toBeNull();
  });

  it("on Android the status lines and the help say Santé Connect", async () => {
    onAndroid(status("allowed", "denied"));
    await turnedOn();
    renderRoute("/settings/health");
    await screen.findByText("Santé Connect refuse les pesées");
    cleanup();
    native.health.mockResolvedValue(status("denied", "allowed"));
    renderRoute("/settings/health");
    await screen.findByText("Santé Connect refuse les entraînements");
    cleanup();
    native.health.mockResolvedValue(status("allowed", "allowed"));
    healthProgress.set({ sending: null, pending: 2 });
    renderRoute("/settings/health");
    await screen.findByText(
      "Santé Connect n’était pas disponible. Nouvel essai à la prochaine ouverture.",
    );
    cleanup();
    native.health.mockResolvedValue(status("denied", "denied"));
    renderRoute("/settings/health");
    await screen.findByText("Santé Connect n’autorise pas Belay à écrire.");
    expect(
      screen.getByText(
        "Autorise-le dans les réglages de Santé Connect › Autorisations des applications › Belay, puis réessaie.",
      ),
    ).toBeTruthy();
  });

  it("on Android the import's sheet names Santé Connect and the instance", async () => {
    onAndroid(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings/health");
    fireEvent.click(await importSwitch());
    const sheet = await screen.findByRole("dialog", {
      name: "Importer tes pesées de Santé Connect\u202f?",
    });
    expect(within(sheet).getByText("belay.example.org").tagName).toBe("STRONG");
    expect(sheet.textContent).toContain(
      "Les pesées que Santé Connect reçoit d’autres apps et appareils, datées d’aujourd’hui ou après, seront ajoutées à Belay et synchronisées avec belay.example.org.",
    );
    expect(sheet.textContent).toContain(
      "Tes pesées plus anciennes pourront ensuite être importées depuis cette page.",
    );
  });

  it("on the iPhone nothing changes", async () => {
    onIPhone(status("allowed", "allowed"));
    await turnedOn();
    renderRoute("/settings");
    const group = await screen.findByRole("region", { name: "Sur cet iPhone" });
    await within(group).findByRole("link", { name: /^Apple Santé/ });
    cleanup();
    renderRoute("/settings/health");
    expect(await screen.findByRole("heading", { level: 1, name: "Apple Santé" })).toBeTruthy();
    expect(
      screen.getByText(
        "Belay ajoute tes séances terminées et tes pesées à l’app Santé de cet iPhone.",
      ),
    ).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Vers Santé" })).toBeTruthy();
    await screen.findByText("À jour avec Santé");
    expect(screen.queryByText(/Santé Connect/)).toBeNull();
  });
});

describe("Réglages › Santé Connect, the weigh-in history", () => {
  // Health Connect's screen stays open until the test answers it.
  function permissionScreen(before: Answer) {
    onAndroid(before);
    let now = before;
    let answer: (after: Answer) => void = () => {};
    native.health.mockImplementation(async ({ op }: { op: string }) =>
      op === "authorize"
        ? new Promise<Answer>((resolve) => {
            answer = resolve;
          })
        : now,
    );
    return (after: Answer) =>
      act(async () => {
        now = after;
        answer(after);
      });
  }
  const older = () => screen.findByRole("button", { name: /^Importer les plus anciennes/ });

  it("the action names Santé Connect, and an undetermined history opens the permission first, then imports whatever the answer", async () => {
    const answer = permissionScreen(withHistory("undetermined"));
    await importTurnedOn();
    renderRoute("/settings/health");
    const action = await screen.findByRole("button", {
      name: /^Importer l’historique de Santé Connect/,
    });
    await syncStarted();
    const before = api.requests.length;
    fireEvent.click(action);
    await waitFor(() =>
      expect(calls("authorize")).toEqual([[{ op: "authorize", scope: "history" }]]),
    );
    expect((await settingsNow()).importSince).not.toBe(HISTORY_SINCE);
    await answer(withHistory("denied"));
    await waitFor(async () => expect((await settingsNow()).importSince).toBe(HISTORY_SINCE));
    expect((await stateNow()).imported.historyWindowed).toBe(true);
    await within(await fromConnect()).findByText("Import de l’historique…");
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
  });

  it("allowed on the permission screen, the history is read whole and the done row knows it", async () => {
    const answer = permissionScreen(withHistory("undetermined"));
    await importTurnedOn();
    renderRoute("/settings/health");
    fireEvent.click(await screen.findByRole("button", { name: /^Importer l’historique/ }));
    await waitFor(() => expect(calls("authorize")).toHaveLength(1));
    await answer(withHistory("allowed"));
    await waitFor(async () => expect((await settingsNow()).importSince).toBe(HISTORY_SINCE));
    expect((await stateNow()).imported.historyWindowed).toBeUndefined();
    await historyRead();
    backInForeground();
    const from = await fromConnect();
    await within(from).findByText("Historique importé");
    expect(within(from).queryByRole("button")).toBeNull();
  });

  it("a denied history asks again at the tap", async () => {
    onAndroid(withHistory("denied"));
    await importTurnedOn();
    renderRoute("/settings/health");
    fireEvent.click(await screen.findByRole("button", { name: /^Importer l’historique/ }));
    await waitFor(() => expect(calls("authorize")).toHaveLength(1));
  });

  it("where Health Connect does not offer the permission, the tap reads without asking", async () => {
    onAndroid(withHistory("unavailable"));
    await importTurnedOn();
    renderRoute("/settings/health");
    fireEvent.click(await screen.findByRole("button", { name: /^Importer l’historique/ }));
    await waitFor(async () => expect((await settingsNow()).importSince).toBe(HISTORY_SINCE));
    expect(calls("authorize")).toHaveLength(0);
    expect((await stateNow()).imported.historyWindowed).toBe(true);
  });

  it("a permission call the phone rejects starts nothing and leaves the action", async () => {
    onAndroid(withHistory("undetermined"));
    await importTurnedOn();
    renderRoute("/settings/health");
    const action = await screen.findByRole("button", { name: /^Importer l’historique/ });
    native.health.mockRejectedValueOnce(new Error("health unavailable"));
    action.focus();
    fireEvent.click(action);
    await waitFor(() => expect(calls("authorize")).toHaveLength(1));
    await act(async () => {});
    expect((await settingsNow()).importSince).not.toBe(HISTORY_SINCE);
    expect(action.isConnected).toBe(true);
    expect(document.activeElement).toBe(action);
  });

  it("done with the history unavailable: the 30-day sentence and the version sentence, no action", async () => {
    onAndroid(withHistory("unavailable"));
    await historyDone(true);
    renderRoute("/settings/health");
    const from = await fromConnect();
    await within(from).findByText("Historique importé");
    expect(
      within(from).getByText(
        "Santé Connect ne donne que les pesées des 30 jours avant ta première autorisation. Cette version de Santé Connect ne donne pas les plus anciennes.",
      ),
    ).toBeTruthy();
    expect(within(from).queryByRole("button")).toBeNull();
  });

  it("done with the history undetermined: « Importer les plus anciennes » says Health Connect will ask", async () => {
    onAndroid(withHistory("undetermined"));
    await historyDone(true);
    renderRoute("/settings/health");
    const from = await fromConnect();
    expect(
      await within(from).findByText(
        "Santé Connect ne donne que les pesées des 30 jours avant ta première autorisation.",
      ),
    ).toBeTruthy();
    expect((await older()).textContent).toContain(
      "Santé Connect te demande d’autoriser l’accès à l’historique.",
    );
  });

  it("done with the history denied: « Importer les plus anciennes » with the settings path, which asks and reads again", async () => {
    const answer = permissionScreen(withHistory("denied"));
    await historyDone(true);
    renderRoute("/settings/health");
    const action = await older();
    expect(action.textContent).toContain(
      "Dans les réglages de Santé Connect › Autorisations des applications › Belay › Accès supplémentaires, active «\u202fAccéder aux anciennes données\u202f», puis touche ici.",
    );
    await syncStarted();
    const before = api.requests.length;
    fireEvent.click(action);
    await waitFor(() =>
      expect(calls("authorize")).toEqual([[{ op: "authorize", scope: "history" }]]),
    );
    await answer(withHistory("allowed"));
    await within(await fromConnect()).findByText("Import de l’historique…");
    const { imported } = await stateNow();
    expect(imported.historyDone).toBe(false);
    expect(imported.historyWindowed).toBeUndefined();
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
  });

  it("the focus waits on the live region while « Importer les plus anciennes » comes back", async () => {
    const answer = permissionScreen(withHistory("denied"));
    await historyDone(true);
    renderRoute("/settings/health");
    const action = await older();
    const live = within(await fromConnect()).getByRole("status");
    action.focus();
    fireEvent.click(action);
    await waitFor(() => expect(calls("authorize")).toHaveLength(1));
    expect(document.activeElement).toBe(action);
    await answer(withHistory("denied"));
    await within(live).findByText("Import de l’historique…");
    expect(document.activeElement).toBe(live);
    await historyRead();
    backInForeground();
    expect(await older()).not.toBe(action);
    expect(document.activeElement).toBe(live);
  });

  it("done with the history allowed: no window sentence", async () => {
    onAndroid(withHistory("allowed"));
    await historyDone();
    renderRoute("/settings/health");
    const from = await fromConnect();
    await within(from).findByText("Historique importé");
    expect(within(from).queryByText(/30 jours/)).toBeNull();
    expect(within(from).queryByRole("button")).toBeNull();
  });

  it("allowed in the settings after a refusal: the action stays, reads again without asking", async () => {
    onAndroid(withHistory("allowed"));
    await historyDone(true);
    renderRoute("/settings/health");
    const from = await fromConnect();
    await within(from).findByText("Historique importé");
    expect(within(from).queryByText(/30 jours/)).toBeNull();
    const action = await older();
    expect(action.textContent).toBe("Importer les plus anciennes");
    await syncStarted();
    const before = api.requests.length;
    fireEvent.click(action);
    await within(from).findByText("Import de l’historique…");
    const { settings, imported } = await stateNow();
    expect(settings.importSince).toBe(HISTORY_SINCE);
    expect(imported.historyDone).toBe(false);
    expect(imported.historyWindowed).toBeUndefined();
    expect(calls("authorize")).toHaveLength(0);
    await waitFor(() => expect(api.requests.length).toBeGreaterThan(before));
  });
});
