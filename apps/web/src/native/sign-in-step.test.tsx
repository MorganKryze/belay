import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { setNativeSession, writeInstance } from "@/lib/platform";
import { renderRoute } from "@/test/render-route";
import type { SignInResult } from "./session";
import { SignInStep } from "./sign-in-step";

// The system sheet and the exchange live in the session module; the step only reads its answer.
const { signIn } = vi.hoisted(() => ({
  signIn: vi.fn<(returnTo: string) => Promise<SignInResult>>(),
}));
vi.mock("@/native/session", () => ({ signIn }));
// Accueil's layout also mounts the rest alert on the phone; its plugin is not what these tests read.
vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: { cancel: async () => {}, schedule: async () => {} },
}));

beforeEach(async () => {
  indexedDB = new IDBFactory();
  writeInstance("https://belay.test");
  setNativeSession({ token: () => null, forget: async () => {} });
  await i18n.changeLanguage("fr");
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

function show(props: Partial<Parameters<typeof SignInStep>[0]> = {}) {
  const root = createRootRoute({
    component: () => <SignInStep unreachable={false} {...props} />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
}

// A sheet still open: the answer comes when the test says so.
function sheet() {
  let close!: (r: SignInResult) => void;
  signIn.mockReturnValue(new Promise((r) => (close = r)));
  return (r: SignInResult) => act(async () => close(r));
}

const signInButton = () => screen.getByRole("button", { name: /Se connecter|Connexion…/ });

describe("SignInStep", () => {
  it("shows the instance's host and the three ways on", async () => {
    show();
    expect(await screen.findByRole("heading", { level: 1, name: "Belay" })).toBeTruthy();
    expect(
      screen.getByText("Connecte-toi pour retrouver tes séances et ton suivi sur ce téléphone."),
    ).toBeTruthy();
    expect(signInButton().textContent).toBe("Se connecter");
    // The host the server named, the scheme left out, in its own emphasis.
    expect(screen.getByText("belay.test").tagName).toBe("STRONG");
    expect(screen.getByText("belay.test").parentElement!.textContent).toBe("Sur belay.test");
    expect(screen.getByRole("button", { name: "Changer d’instance" })).toBeTruthy();
    const tools = screen.getByRole("link", { name: "Utiliser les outils sans compte" });
    expect(tools.getAttribute("href")).toBe("/tools");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Se connecter shows Connexion… and calls signIn with /", async () => {
    const close = sheet();
    show();
    await screen.findByRole("heading", { level: 1, name: "Belay" });
    fireEvent.click(signInButton());
    const busy = await screen.findByRole("button", { name: "Connexion…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(signIn).toHaveBeenCalledExactlyOnceWith("/");
    // A second press while the sheet is up opens nothing more.
    fireEvent.click(busy);
    expect(signIn).toHaveBeenCalledOnce();
    await close("cancelled");
  });

  it("a cancel goes back to idle with no message", async () => {
    const close = sheet();
    show();
    await screen.findByRole("heading", { level: 1, name: "Belay" });
    fireEvent.click(signInButton());
    await screen.findByRole("button", { name: "Connexion…" });
    await close("cancelled");
    const idle = screen.getByRole("button", { name: "Se connecter" });
    expect(idle.getAttribute("aria-busy")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // Back from the sheet where it left, to try again.
    expect(document.activeElement).toBe(idle);
  });

  it.each([
    [
      "denied",
      "Ton compte n’a pas accès à Belay. Demande l’accès à la personne qui gère cette instance.",
    ],
    ["expired", "La connexion a pris trop de temps. Réessaie."],
    ["unavailable", "La connexion est indisponible pour le moment. Réessaie dans un instant."],
    ["failed", "La connexion n’a pas abouti. Réessaie."],
  ] as const)("each failure shows its signin line: %s", async (reason, line) => {
    const close = sheet();
    show();
    await screen.findByRole("heading", { level: 1, name: "Belay" });
    fireEvent.click(signInButton());
    await close(reason);
    expect(screen.getByRole("alert").textContent).toBe(line);
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeTruthy();
  });

  it("a failure brought back by Accueil shows, and a new try clears it", async () => {
    const close = sheet();
    show({ failure: "expired" });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La connexion a pris trop de temps. Réessaie.",
    );
    fireEvent.click(signInButton());
    expect(screen.queryByRole("alert")).toBeNull();
    await close("cancelled");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a sign-in that cannot load says it failed", async () => {
    signIn.mockRejectedValue(new Error("chunk"));
    show();
    await screen.findByRole("heading", { level: 1, name: "Belay" });
    fireEvent.click(signInButton());
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La connexion n’a pas abouti. Réessaie.",
    );
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeTruthy();
  });

  it("an unreachable instance shows the server line, the button still there", async () => {
    show({ unreachable: true });
    expect((await screen.findByRole("status")).textContent).toBe(
      "Le serveur est injoignable pour le moment.",
    );
    expect(signInButton()).toHaveProperty("disabled", false);
  });

  it("Changer d’instance opens the instance screen with the address, Annuler comes back", async () => {
    show();
    await screen.findByRole("heading", { level: 1, name: "Belay" });
    fireEvent.click(screen.getByRole("button", { name: "Changer d’instance" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ton instance" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Adresse de l’instance" })).toHaveProperty(
      "value",
      "belay.test",
    );
    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Belay" })).toBeTruthy();
    // Back on the link that opened it, for whoever moves by keyboard or VoiceOver.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Changer d’instance" }));
    expect(signIn).not.toHaveBeenCalled();
  });
});

describe("Accueil signed out on the phone, an instance stored", () => {
  beforeEach(() => {
    vi.stubGlobal("Capacitor", { isNativePlatform: () => true });
  });

  it("shows the sign-in step in place of the web's sign-in link", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    renderRoute("/");
    expect(await screen.findByRole("button", { name: "Se connecter" })).toBeTruthy();
    expect(screen.getByText("belay.test")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Se connecter" })).toBeNull();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://belay.test/api/me");
  });

  it("carries the failure Accueil was opened with", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    renderRoute("/?signin=denied");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ton compte n’a pas accès à Belay. Demande l’accès à la personne qui gère cette instance.",
    );
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeTruthy();
  });

  it("says when the instance cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    renderRoute("/");
    // The layout has live regions of its own: the line is found by its words, then its role.
    const line = await screen.findByText("Le serveur est injoignable pour le moment.");
    expect(line.getAttribute("role")).toBe("status");
    expect(screen.getByRole("button", { name: "Se connecter" })).toBeTruthy();
  });
});
