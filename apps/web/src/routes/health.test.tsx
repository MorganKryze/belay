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
  healthProgress,
  markHistorySent,
  readHealth,
  setHealthOn,
  setHealthRunner,
  setImportOn,
} from "../native/health";

type Access = "allowed" | "denied" | "undetermined";
const status = (workouts: Access, weighings: Access, available = true) => ({
  available,
  workouts,
  weighings,
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
function onIPhone(...answers: ReturnType<typeof status>[]) {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
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
const settingsNow = async () => {
  const db = await openAccountDb(ADA.id);
  const { settings } = await readHealth(db);
  db.close();
  return settings;
};
async function turnedOn() {
  const db = await openAccountDb(ADA.id);
  await setHealthOn(db, true, Date.now());
  db.close();
}

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
    expect(screen.getByText(/Autorise-le dans Réglages › Santé/)).toBeTruthy();
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
