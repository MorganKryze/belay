import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "@belay/shared/sync/schema";
import i18n from "../i18n";
import { pendingCounts } from "../sync/db";
import { readLastUser } from "../sync/last-user";
import { answer } from "../test/answer";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

// Passes through, until a test makes the local read fail.
vi.mock("../sync/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("../sync/db")>();
  return { ...real, pendingCounts: vi.fn(real.pendingCounts) };
});

const assign = vi.fn();
const idp = "https://idp.example/logout";

beforeEach(() => {
  indexedDB = new IDBFactory();
  assign.mockClear();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(async () => {
  vi.mocked(pendingCounts).mockReset(); // back to the real read
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

// Signed in; `logout` is what POST /auth/logout answers, `sync` what /api/sync does.
function signedIn(logout: () => Promise<Response>, sync?: () => Promise<Response>) {
  const api = fakeApi({ me: ADA, logout, sync });
  renderRoute("/settings");
  return api;
}
const logoutCalls = (api: ReturnType<typeof fakeApi>) =>
  api.fetchMock.mock.calls.filter(([url]) => url === "/auth/logout");
const signOutButton = () => screen.findByRole("button", { name: "Sign out" });

describe("Settings sign-out", () => {
  it("is not offered to someone signed out", async () => {
    fakeApi({ me: null });
    renderRoute("/settings");
    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.queryByRole("heading", { name: "Account" })).toBeNull();
  });

  it("navigates to the redirectTo the server returns, and forgets the account", async () => {
    const api = signedIn(async () => Response.json({ redirectTo: idp }));
    fireEvent.click(await signOutButton());
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
    expect(logoutCalls(api)).toHaveLength(1);
    expect(readLastUser()).toBeNull();
  });

  it("shows an alert and stays put when the server answers with a non-JSON error", async () => {
    signedIn(async () => new Response("Bad Gateway", { status: 502 }));
    fireEvent.click(await signOutButton());
    expect(await screen.findByText(/Couldn't sign you out/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows an alert when the request itself fails (offline)", async () => {
    signedIn(async () => {
      throw new TypeError("Failed to fetch");
    });
    fireEvent.click(await signOutButton());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("never navigates to undefined when redirectTo is missing", async () => {
    signedIn(async () => Response.json({}));
    fireEvent.click(await signOutButton());
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("sends a single POST when the button is clicked twice", async () => {
    let finish!: (r: Response) => void;
    const api = signedIn(() => new Promise<Response>((resolve) => (finish = resolve)));
    fireEvent.click(await signOutButton());
    const button = screen.getByRole("button", { name: "Sign out" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    expect(logoutCalls(api)).toHaveLength(1);
    finish(Response.json({ redirectTo: idp }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });

  it("says first what has not been sent, and that it will go at the next sign-in", async () => {
    await seed(ADA.id, [weight("2026-10-06", 80.2), weight("2026-10-07", 79.8)]);
    // The server is down for syncs, so both entries stay queued.
    const api = signedIn(
      async () => Response.json({ redirectTo: idp }),
      async () => new Response(null, { status: 503 }),
    );
    fireEvent.click(await signOutButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "2 entries not sent yet: they will go at your next sign-in on this device.",
    );
    expect(logoutCalls(api)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(await signOutButton());
    fireEvent.click(await screen.findByRole("button", { name: "Sign out anyway" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
  });

  it("moves focus into the confirmation, and back to Sign out on Cancel", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    signedIn(
      async () => Response.json({ redirectTo: idp }),
      async () => new Response(null, { status: 503 }),
    );
    fireEvent.click(await signOutButton());
    const anyway = await screen.findByRole("button", { name: "Sign out anyway" });
    expect(document.activeElement).toBe(anyway);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(await signOutButton());
  });

  it("still offers sign-out when the local read fails, always asking first", async () => {
    vi.mocked(pendingCounts).mockRejectedValue(new DOMException("lost", "InvalidStateError"));
    const api = signedIn(async () => Response.json({ redirectTo: idp }));
    fireEvent.click(await signOutButton());
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Some entries may not have been sent yet: they will go at your next sign-in on this device.",
    );
    expect(logoutCalls(api)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Sign out anyway" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
  });

  it("says it in French, with the narrow space before the colon", async () => {
    await i18n.changeLanguage("fr");
    vi.mocked(pendingCounts).mockRejectedValue(new DOMException("lost", "InvalidStateError"));
    signedIn(async () => Response.json({ redirectTo: idp }));
    fireEvent.click(await screen.findByRole("button", { name: "Se déconnecter" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Des saisies n'ont peut-être pas encore été envoyées\u202f: elles partiront à ta prochaine connexion sur cet appareil.",
    );
  });
});

describe("refused entries", () => {
  it("lists what the server refused, then clears the list", async () => {
    await seed(ADA.id, [
      weight("2026-10-05", 80),
      { kind: "target", minPct: 0.25, maxPct: 0.75, at: "2026-10-05T06:30:00.000Z" },
    ]);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({
            rejected: r.changes.map((_, index) => ({
              index,
              reason: index === 0 ? "refused" : "unknown",
            })),
          }),
        ),
    });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Refused entries" });
    expect(list.textContent).toMatch(/Weigh-in for \w{3}, Oct 5/);
    expect(list.textContent).toContain("Refused by the server");
    expect(list.textContent).toContain("Loss range");
    expect(list.textContent).toContain("Not found on the server");
    fireEvent.click(screen.getByRole("button", { name: "Clear the list" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Refused entries" })).toBeNull(),
    );
  });

  const SUPPLEMENT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01";
  const ANNOTATION = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d02";
  const at = "2026-10-05T06:30:00.000Z";
  const day = "2026-10-05";
  const cases: [string, Change[], Change["kind"], string, string][] = [
    [
      "waist",
      [{ kind: "measure", date: day, field: "waist", value: 80, at }],
      "measure",
      "Waist on",
      "Tour de taille du",
    ],
    [
      "neck",
      [{ kind: "measure", date: day, field: "neck", value: 38, at }],
      "measure",
      "Neck on",
      "Tour de cou du",
    ],
    [
      "hip",
      [{ kind: "measure", date: day, field: "hip", value: 95, at }],
      "measure",
      "Hips on",
      "Tour de hanches du",
    ],
    [
      "intake",
      [{ kind: "intake", date: day, field: "kcal", value: 2000, at }],
      "intake",
      "Intake for",
      "Apports du",
    ],
    [
      "formula",
      [{ kind: "profile", field: "formula", value: "male", at }],
      "profile",
      "Profile: formula",
      "Profil\u202f: formule",
    ],
    [
      "birth year",
      [{ kind: "profile", field: "birthYear", value: 1990, at }],
      "profile",
      "Profile: year of birth",
      "Profil\u202f: année de naissance",
    ],
    [
      "height",
      [{ kind: "profile", field: "height", value: 180, at }],
      "profile",
      "Profile: height",
      "Profil\u202f: taille",
    ],
    [
      "supplement",
      [{ kind: "supplement", id: SUPPLEMENT, field: "name", value: "Zinc", at }],
      "supplement",
      "Supplement: Zinc",
      "Complément\u202f: Zinc",
    ],
    [
      "annotation",
      [
        {
          kind: "annotation",
          id: ANNOTATION,
          field: "fields",
          date: day,
          type: "note",
          label: null,
          at,
        },
      ],
      "annotation",
      "Annotation for",
      "Annotation du",
    ],
  ];
  it.each(cases)("names a refused %s entry", async (_, changes, kind, en, fr) => {
    await seed(ADA.id, changes);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({
            rejected: r.changes.flatMap((c, index) =>
              c.kind === kind ? [{ index, reason: "refused" as const }] : [],
            ),
          }),
        ),
    });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Refused entries" });
    expect(list.textContent).toContain(en);
    expect(list.textContent).not.toContain("Loss range");
    cleanup();
    await i18n.changeLanguage("fr");
    renderRoute("/settings");
    expect((await screen.findByRole("region", { name: "Saisies refusées" })).textContent).toContain(
      fr,
    );
  });

  it("names the supplement of a refused tick", async () => {
    await seed(ADA.id, [{ kind: "supplement", id: SUPPLEMENT, field: "name", value: "Zinc", at }]);
    const first = fakeApi({ me: ADA });
    renderRoute("/settings");
    await screen.findByRole("heading", { name: "Settings" });
    cleanup();
    first.fetchMock.mockReset();
    await seed(ADA.id, [
      { kind: "supplementLog", supplementId: SUPPLEMENT, date: day, taken: true, at },
    ]);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({
            rejected: r.changes.flatMap((c, index) =>
              c.kind === "supplementLog" ? [{ index, reason: "refused" as const }] : [],
            ),
          }),
        ),
    });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Refused entries" });
    expect(list.textContent).toMatch(/Zinc \(ticked on \w{3}, Oct 5\)/);
  });

  it("is not shown when the server refused nothing", async () => {
    signedIn(async () => Response.json({ redirectTo: idp }));
    await signOutButton();
    expect(screen.queryByRole("region", { name: "Refused entries" })).toBeNull();
  });
});
