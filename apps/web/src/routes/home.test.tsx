import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { writeLastUser } from "../sync/last-user";
import { answer } from "../test/answer";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

beforeEach(() => {
  indexedDB = new IDBFactory();
});
afterEach(async () => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

describe("Home", () => {
  it("offers sign-in and the tools when nobody is signed in", async () => {
    fakeApi({ me: null });
    renderRoute("/");
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/auth/login?returnTo=%2F");
    expect(screen.getByRole("heading", { name: "Belay", level: 1 })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Use the tools without an account" }).getAttribute("href"),
    ).toBe("/tools");
  });

  it("greets the signed-in user by name", async () => {
    fakeApi({ me: ADA });
    renderRoute("/");
    expect(await screen.findByRole("heading", { name: "Hello, Ada", level: 1 })).toBeTruthy();
  });

  it("greets in French without a comma", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/");
    expect(await screen.findByRole("heading", { name: "Bonjour Ada", level: 1 })).toBeTruthy();
  });

  it("says the server is unreachable instead of crashing", async () => {
    fakeApi({ me: "down" });
    renderRoute("/");
    expect(await screen.findByText("Can't reach the server right now.")).toBeTruthy();
  });

  it("says so when this browser refuses to save on the device", async () => {
    fakeApi({ me: ADA });
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    renderRoute("/");
    expect(await screen.findByText(/won't let Belay save on the device/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Use the tools without an account" })).toBeTruthy();
  });
});

describe("Home sign-in failure", () => {
  it.each([
    ["unavailable", "Sign-in is unavailable right now. Try again in a moment."],
    ["expired", "Your sign-in took too long. Please try again."],
    ["failed", "Sign-in didn't work. Please try again."],
    ["denied", "Your account doesn't have access to Belay. Ask the person who runs this instance."],
  ])(
    "?signin=%s shows a localized alert, with the Sign in link still there",
    async (reason, text) => {
      fakeApi({ me: null });
      renderRoute(`/?signin=${reason}`);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(text);
      expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    },
  );

  it("speaks French when the app is in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: null });
    renderRoute("/?signin=expired");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La connexion a pris trop de temps. Réessaie.",
    );
  });

  it("tells a refused account in French that it has no access", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: null });
    renderRoute("/?signin=denied");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Ton compte n'a pas accès à Belay. Demande l'accès à la personne qui gère cette instance.",
    );
  });

  it("removes the param from the URL but keeps the message, so a reload shows nothing", async () => {
    fakeApi({ me: null });
    const router = renderRoute("/?signin=failed");
    await screen.findByRole("alert");
    await waitFor(() => expect(router.history.location.search).toBe(""));
    expect(screen.getByRole("alert").textContent).toBe("Sign-in didn't work. Please try again.");
  });

  it("ignores an unknown reason: no message, and the param is dropped anyway", async () => {
    fakeApi({ me: null });
    const router = renderRoute("/?signin=<b>hacked</b>");
    await screen.findByRole("link", { name: "Sign in" });
    await waitFor(() => expect(router.history.location.search).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/hacked/)).toBeNull();
  });

  it("shows no failure to someone who is signed in", async () => {
    fakeApi({ me: ADA });
    renderRoute("/?signin=failed");
    await screen.findByRole("heading", { name: "Hello, Ada" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("the sync banner", () => {
  it("says offline with weigh-ins waiting, and that they are kept on the phone", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2), weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/");
    expect(
      await screen.findByText(
        "2 weigh-ins waiting, sent as soon as the network is back. Everything is kept on this phone.",
        { exact: false },
      ),
    ).toBeTruthy();
    expect(screen.getByText("Offline.")).toBeTruthy();
  });

  it("counts entries, not weigh-ins, once something else waits too", async () => {
    await seed(ADA.id, [
      weight("2026-10-07", 79.8),
      {
        kind: "intake",
        date: "2026-10-07",
        field: "kcal",
        value: 2100,
        at: "2026-10-07T07:00:00.000Z",
      },
    ]);
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/");
    expect(
      await screen.findByText(/2 entries waiting, sent as soon as the network is back/),
    ).toBeTruthy();
  });

  it("asks to sign in again when the session expired with weigh-ins waiting", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    fakeApi({ me: null });
    renderRoute("/");
    expect(await screen.findByText("Your session has expired.")).toBeTruthy();
    expect(screen.getByText(/1 weigh-in is waiting to be sent/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in again" }).getAttribute("href")).toBe(
      "/auth/login?returnTo=%2F",
    );
  });

  it("offers to try again after a refusal, keeping the entry", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    const api = fakeApi({ me: ADA, sync: async () => new Response(null, { status: 400 }) });
    renderRoute("/");
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.requests.length).toBeGreaterThanOrEqual(2));
    expect(api.requests.at(-1)!.changes).toEqual([weight("2026-10-07", 79.8)]);
    expect(screen.getByText("An entry couldn't be sent.")).toBeTruthy();
  });

  it("says when the server refused an entry, and where to read about it", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({ rejected: r.changes.length > 0 ? [{ index: 0, reason: "refused" }] : [] }),
        ),
    });
    renderRoute("/");
    expect(await screen.findByText(/An entry was refused\./)).toBeTruthy();
    expect(screen.getByRole("link", { name: "See details" }).getAttribute("href")).toBe(
      "/settings",
    );
  });

  it("shows nothing once everything is sent", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    const api = fakeApi({ me: ADA });
    renderRoute("/");
    await screen.findByRole("heading", { name: "Hello, Ada" });
    await waitFor(() => expect(api.rows.size).toBe(1));
    expect(screen.queryByText(/waiting/)).toBeNull();
  });

  it("shows nothing offline when nothing waits, not even the generic offline line", async () => {
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderRoute("/");
    await screen.findByRole("heading", { name: "Hello, Ada" });
    expect(screen.queryByText("You're offline.")).toBeNull();
    expect(screen.queryByText("Offline.")).toBeNull();
  });

  it("keeps the generic offline line for someone signed out", async () => {
    fakeApi({ me: "down" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderRoute("/");
    expect(await screen.findByText("You're offline.")).toBeTruthy();
  });
});
