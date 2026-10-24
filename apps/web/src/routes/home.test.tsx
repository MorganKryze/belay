import { addDays } from "@belay/shared/body/dates";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  vi.useRealTimers();
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

  it("while the account loads Home shows the loader, with no title", async () => {
    // /api/me never answers and nobody is remembered: the account stays unknown.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderRoute("/");
    expect((await screen.findByText("Loading…")).getAttribute("role")).toBe("status");
    expect(document.querySelector("[data-pending] .loader-mark")).not.toBeNull();
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
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

  it("greets with the day's date above the title", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 7, 30));
    fakeApi({ me: ADA });
    renderRoute("/");
    const h1 = await screen.findByRole("heading", { name: "Hello, Ada", level: 1 });
    const date = screen.getByText("Wednesday, October 7");
    expect(date.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    await i18n.changeLanguage("fr");
    renderRoute("/");
    const titre = await screen.findByRole("heading", { name: "Bonjour Ada", level: 1 });
    const jour = screen.getByText("Mercredi 7 octobre");
    expect(jour.compareDocumentPosition(titre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no date to someone signed out", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 7, 30));
    fakeApi({ me: null });
    renderRoute("/");
    await screen.findByRole("link", { name: "Sign in" });
    expect(screen.queryByText("Wednesday, October 7")).toBeNull();
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

describe("the title's avatar", () => {
  // The top bar carries its own avatar from 1 024 px (checked on a real screen in e2e).
  const titleAvatar = async (title: string) => {
    const heading = await screen.findByRole("heading", { name: title, level: 1 });
    return within(heading.parentElement!).getByRole("link", { name: "Settings" });
  };

  it.each([
    ["signed in", "Hello, Ada", () => fakeApi({ me: ADA })],
    ["signed out", "Belay", () => fakeApi({ me: null })],
    [
      "unavailable",
      "Hello, Ada",
      () => {
        fakeApi({ me: ADA });
        vi.spyOn(indexedDB, "open").mockImplementation(() => {
          throw new DOMException("denied", "SecurityError");
        });
      },
    ],
  ])(
    "the title's avatar is hidden from 1 024 px in every account state: %s",
    async (_, title, api) => {
      api();
      renderRoute("/");
      expect((await titleAvatar(title)).parentElement!.className).toBe("lg:hidden");
    },
  );
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

  it("the offline line eases down into place", async () => {
    fakeApi({ me: "down" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    renderRoute("/");
    const line = await screen.findByText("You're offline.");
    expect(line.classList).toContain("animate-drop-in");
  });

  it("the sync banner eases down into place", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    writeLastUser(ADA);
    fakeApi({ me: "down" });
    renderRoute("/");
    const title = await screen.findByText("Offline.");
    expect(title.closest(".rounded-field")!.classList).toContain("animate-drop-in");
  });
});

describe("the trend", () => {
  // Wednesday 7 October: the weeks of 21 and 28 September are complete.
  const week = (monday: string, kg: number) =>
    [0, 1, 2, 3].map((d) => weight(addDays(monday, d), kg));
  async function open(changes: Parameters<typeof seed>[1]) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 7, 30));
    await seed(ADA.id, changes);
    fakeApi({ me: ADA });
    renderRoute("/");
  }
  const card = () => screen.findByRole("link", { name: /^7-day average/ });

  it("the trend is one link to Body with the average as its figure", async () => {
    await open([...week("2026-09-21", 80.8), ...week("2026-09-28", 80.4)]);
    const trend = await screen.findByRole("region", { name: "Your trend" });
    expect(within(trend).getByRole("heading", { level: 2 })).toBeTruthy();
    const link = await card();
    expect(within(trend).getAllByRole("link")).toEqual([link]);
    await waitFor(() => expect(link.textContent).toContain("80.4 kg"));
    expect(link.getAttribute("href")).toBe("/body");
  });

  it("loss line and the in-range pill by Body's rule", async () => {
    await open([...week("2026-09-21", 80.8), ...week("2026-09-28", 80.4)]);
    const link = await card();
    await waitFor(() => expect(link.textContent).toContain("loss 0.5%/wk last week"));
    expect(within(link).getByText("in your range")).toBeTruthy();
  });

  it("no pill outside the range", async () => {
    await open([
      ...week("2026-09-21", 80.8),
      ...week("2026-09-28", 80.4),
      { kind: "target", minPct: 0.6, maxPct: 1, at: "2026-10-01T06:00:00.000Z" },
    ]);
    const link = await card();
    await waitFor(() => expect(link.textContent).toContain("loss 0.5%/wk last week"));
    expect(within(link).queryByText("in your range")).toBeNull();
  });

  it("with the range pill hidden on this device, Accueil's trend card shows no pill", async () => {
    localStorage.setItem("belay.rangePill", "hidden");
    await open([...week("2026-09-21", 80.8), ...week("2026-09-28", 80.4)]);
    const link = await card();
    await waitFor(() => expect(link.textContent).toContain("loss 0.5%/wk last week"));
    expect(within(link).queryByText("in your range")).toBeNull();
  });

  it("a gain says gain, in French too", async () => {
    await i18n.changeLanguage("fr");
    await open([...week("2026-09-21", 80.3), ...week("2026-09-28", 80.5)]);
    const link = await screen.findByRole("link", { name: /^Moyenne 7 jours/ });
    await waitFor(() => expect(link.textContent).toContain("prise 0,2 %/sem la semaine dernière"));
    expect(within(link).queryByText("dans ta fourchette")).toBeNull();
  });

  it("no average yet: —; no complete week: no line", async () => {
    await open([weight("2026-09-01", 80)]);
    const link = await card();
    await waitFor(() => expect(link.textContent).toContain("—"));
    expect(link.textContent).not.toContain("last week");
  });

  it("hidden on this device: no Your trend heading and no card", async () => {
    localStorage.setItem("belay.homeTrend", "hidden");
    await open([...week("2026-09-21", 80.8), ...week("2026-09-28", 80.4)]);
    await screen.findByRole("heading", { name: "Hello, Ada", level: 1 });
    await screen.findByRole("button", { name: /^Weigh-in/ });
    expect(screen.queryByRole("heading", { name: "Your trend" })).toBeNull();
    expect(screen.queryByRole("link", { name: /^7-day average/ })).toBeNull();
  });
});
