import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { readInstance, setNativeSession } from "@/lib/platform";
import { fakeApi } from "@/test/fake-api";
import { renderRoute } from "@/test/render-route";
import type { Probe } from "./address";
import { InstanceSetup } from "./instance-setup";

// The question asked to the address is the only network part; reading what was typed stays real.
const { probe } = vi.hoisted(() => ({ probe: vi.fn<(origin: string) => Promise<Probe>>() }));
vi.mock("./address", async (original) => ({
  ...(await original<typeof import("./address")>()),
  probeInstance: probe,
}));

const replace = vi.fn();
const forget = vi.fn(async () => {});

beforeEach(async () => {
  indexedDB = new IDBFactory();
  vi.stubGlobal("location", { ...window.location, replace });
  setNativeSession({ token: () => null, forget });
  await i18n.changeLanguage("fr");
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await i18n.changeLanguage("en");
});

function show(props: Parameters<typeof InstanceSetup>[0] = {}) {
  const root = createRootRoute({ component: () => <InstanceSetup {...props} /> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

const field = () => screen.getByRole("textbox", { name: "Adresse de l’instance" });
const button = () => screen.getByRole("button", { name: /Continuer|Vérification…/ });
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });

describe("InstanceSetup", () => {
  it("Continuer stays disabled while the field is empty", async () => {
    show();
    expect(await screen.findByRole("heading", { level: 1, name: "Ton instance" })).toBeTruthy();
    expect(button()).toHaveProperty("disabled", true);
    type("   ");
    expect(button()).toHaveProperty("disabled", true);
    type("belay.exemple.fr");
    expect(button()).toHaveProperty("disabled", false);
  });

  it("asks for an address with the phone's URL keyboard, nothing corrected", async () => {
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    const input = field();
    expect(input.getAttribute("type")).toBe("url");
    expect(input.getAttribute("inputmode")).toBe("url");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.getAttribute("enterkeyhint")).toBe("go");
    expect(input.getAttribute("placeholder")).toBe("belay.exemple.fr");
    expect(
      screen.getByText(
        "Le serveur Belay que quelqu’un héberge pour toi, ou que tu héberges toi-même. Entre son adresse.",
      ),
    ).toBeTruthy();
  });

  it("an unreadable address shows the invalid error on the field, focus kept", async () => {
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("belay test");
    fireEvent.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "Cette adresse n’est pas valide. Exemple\u202f: belay.exemple.fr",
    );
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(field());
    expect(probe).not.toHaveBeenCalled();
    // Corrected, the reproach goes; it comes back only at the next Continuer.
    type("belay.test");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });

  it("plain http to another machine asks for https", async () => {
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("http://belay.test");
    // The keyboard's Go key submits the field's form.
    fireEvent.submit(field());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "L’adresse doit commencer par https://",
    );
    expect(document.activeElement).toBe(field());
    expect(probe).not.toHaveBeenCalled();
  });

  it("a release build asks for https even on this machine", async () => {
    vi.stubEnv("DEV", false);
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("http://localhost:3000");
    fireEvent.submit(field());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "L’adresse doit commencer par https://",
    );
    expect(probe).not.toHaveBeenCalled();
  });

  it("Continuer checks the address and shows Vérification… on the busy button, the field read-only", async () => {
    let answer!: (p: Probe) => void;
    probe.mockReturnValue(new Promise((r) => (answer = r)));
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("  Belay.Test/accueil ");
    fireEvent.click(button());
    expect(probe).toHaveBeenCalledWith("https://belay.test");
    const busy = await screen.findByRole("button", { name: "Vérification…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(field()).toHaveProperty("readOnly", true);
    await act(async () => answer({ error: "unreachable" }));
    expect(await screen.findByRole("button", { name: "Continuer" })).toBeTruthy();
    expect(field()).toHaveProperty("readOnly", false);
  });

  it.each([
    ["not-belay", "Aucune instance Belay ne répond à cette adresse. Vérifie-la."],
    [
      "unreachable",
      "Impossible de joindre cette adresse. Vérifie-la, ou vérifie que l’instance est à jour.",
    ],
    ["offline", "Pas de connexion. Réessaie une fois en ligne."],
  ] as const)("%s shows its line on the field", async (error, line) => {
    probe.mockResolvedValue({ error });
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("belay.test");
    fireEvent.click(button());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(line);
    expect(field().getAttribute("aria-describedby")).toBe(alert.id);
    expect(document.activeElement).toBe(field());
    expect(readInstance()).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it("a found instance keeps the server's origin, forgets the old token and reopens the app", async () => {
    let forgotten!: () => void;
    forget.mockReturnValue(new Promise<void>((r) => (forgotten = r)));
    probe.mockResolvedValue({ origin: "https://belay.example.org" });
    show({ current: "https://old.example.org" });
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("belay.test");
    fireEvent.click(button());
    await waitFor(() => expect(forget).toHaveBeenCalledOnce());
    // The server's own origin, not the alias typed.
    expect(readInstance()).toBe("https://belay.example.org");
    // The new start waits for the old token to leave.
    expect(replace).not.toHaveBeenCalled();
    await act(async () => forgotten());
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("with no instance before, the token is forgotten too", async () => {
    probe.mockResolvedValue({ origin: "https://belay.test" });
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("belay.test");
    fireEvent.click(button());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(forget).toHaveBeenCalledOnce();
  });

  it("the same instance found again keeps its token", async () => {
    probe.mockResolvedValue({ origin: "https://belay.test" });
    show({ current: "https://belay.test" });
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("belay.test");
    fireEvent.click(button());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(forget).not.toHaveBeenCalled();
  });

  it("a token that cannot be removed still lets the app reopen on the new instance", async () => {
    forget.mockRejectedValue(new Error("keychain"));
    probe.mockResolvedValue({ origin: "https://belay.test" });
    show({ current: "https://old.example.org" });
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    type("belay.test");
    fireEvent.click(button());
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    expect(readInstance()).toBe("https://belay.test");
  });

  it("opened with the stored address it shows it and Annuler goes back unchanged", async () => {
    const onCancel = vi.fn();
    show({ current: "https://belay.test", onCancel });
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    expect(field()).toHaveProperty("value", "belay.test");
    // Opened to check the address, often: no keyboard until the field is tapped.
    expect(document.activeElement).not.toBe(field());
    type("autre.exemple.fr");
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(probe).not.toHaveBeenCalled();
    expect(readInstance()).toBeNull();
  });

  it("the first launch offers no Annuler", async () => {
    show();
    await screen.findByRole("heading", { level: 1, name: "Ton instance" });
    expect(screen.queryByRole("button", { name: "Annuler" })).toBeNull();
  });

  it("the tools link stays", async () => {
    show();
    const tools = await screen.findByRole("link", { name: "Utiliser les outils sans compte" });
    expect(tools.getAttribute("href")).toBe("/tools");
    expect(screen.getByRole("link", { name: "Réglages" }).getAttribute("href")).toBe("/settings");
  });
});

describe("Accueil signed out", () => {
  it("on the phone with no instance, asks for the instance and nothing else", async () => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
    const { fetchMock } = fakeApi();
    renderRoute("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Ton instance" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Se connecter" })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("in a browser, still offers the sign-in", async () => {
    fakeApi();
    renderRoute("/");
    expect(await screen.findByRole("link", { name: "Se connecter" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Ton instance" })).toBeNull();
  });
});
