import { IDBFactory } from "fake-indexeddb";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode } from "@belay/shared/training/program";
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

// Radix Select calls pointer-capture and scrolling APIs jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
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

// Opens a preference row's menu from the keyboard and picks an option.
async function choose(row: RegExp, option: string) {
  const trigger = await screen.findByRole("combobox", { name: row });
  act(() => trigger.focus());
  fireEvent.keyDown(trigger, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: option }));
}

describe("Settings preferences", () => {
  afterEach(() => document.documentElement.classList.remove("dark"));

  // Each section and the names of its rows, in order, as a person signed in first finds them.
  const SECTIONS = [
    ["General", ["General · Language · English", "General · Theme · System"]],
    ["Home", ["Home · Trend · Shown"]],
    [
      "Sessions",
      [
        "Sessions · Paused · Everything stops",
        "Sessions · History · With activities",
        "Sessions · Volume · Shown",
      ],
    ],
    ["Body", ["Body · Range · Shown", "Body · Intake · Shown"]],
  ] as const;

  it("groups the eight rows under General, Home, Sessions and Body, in order, each showing its value", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    const general = await screen.findByRole("region", { name: "General" });
    const regions = SECTIONS.map(([name]) => screen.getByRole("region", { name }));
    expect(regions[0]).toBe(general);
    regions
      .slice(1)
      .forEach((after, i) =>
        expect(regions[i]!.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      );
    SECTIONS.forEach(([, names], i) => {
      const rows = within(regions[i]!).getAllByRole("combobox");
      expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(names);
    });
    expect(screen.queryByRole("region", { name: "Preferences" })).toBeNull();
  });

  it("names the sections and rows in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/settings");
    const names = [
      ["Général", ["Général · Langue · Français", "Général · Thème · Système"]],
      ["Accueil", ["Accueil · Tendance · Affichée"]],
      ["Séances", ["Séances · En pause · Tout s'arrête", "Séances · Historique · Avec activités"]],
      ["Corps", ["Corps · Fourchette · Affichée", "Corps · Apports · Affichés"]],
    ] as const;
    await screen.findByRole("region", { name: "Général" });
    for (const [section, rows] of names) {
      const region = screen.getByRole("region", { name: section });
      for (const name of rows) expect(within(region).getByRole("combobox", { name })).toBeTruthy();
    }
    expect(screen.getByRole("combobox", { name: "Séances · Volume · Affiché" })).toBeTruthy();
  });

  it("keeps on this device whether a pause also stops the rest", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Sessions · Paused/, "Rest continues");
    expect(localStorage.getItem("belay.pauseStops")).toBe("session");
    expect(
      await screen.findByRole("combobox", { name: "Sessions · Paused · Rest continues" }),
    ).toBeTruthy();
    await choose(/^Sessions · Paused/, "Everything stops");
    expect(localStorage.getItem("belay.pauseStops")).toBe("all");
  });

  it("says the pause row in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Séances · En pause/, "Le repos continue");
    expect(
      await screen.findByRole("combobox", { name: "Séances · En pause · Le repos continue" }),
    ).toBeTruthy();
    await choose(/^Séances · En pause/, "Tout s'arrête");
    expect(localStorage.getItem("belay.pauseStops")).toBe("all");
  });

  it("Trend offers Shown and Hidden and keeps the choice on this device", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Home · Trend/, "Hidden");
    expect(localStorage.getItem("belay.homeTrend")).toBe("hidden");
    expect(await screen.findByRole("combobox", { name: "Home · Trend · Hidden" })).toBeTruthy();
    await choose(/^Home · Trend/, "Shown");
    expect(localStorage.getItem("belay.homeTrend")).toBe("shown");
  });

  it("says the trend row in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Accueil · Tendance/, "Masquée");
    expect(
      await screen.findByRole("combobox", { name: "Accueil · Tendance · Masquée" }),
    ).toBeTruthy();
    await choose(/^Accueil · Tendance/, "Affichée");
    expect(localStorage.getItem("belay.homeTrend")).toBe("shown");
  });

  it("Range offers Shown and Hidden and keeps the choice on this device", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Body · Range/, "Hidden");
    expect(localStorage.getItem("belay.rangePill")).toBe("hidden");
    expect(await screen.findByRole("combobox", { name: "Body · Range · Hidden" })).toBeTruthy();
    expect(localStorage.getItem("belay.weekIntake")).toBeNull();
    await choose(/^Body · Range/, "Shown");
    expect(localStorage.getItem("belay.rangePill")).toBe("shown");
  });

  it("Intake offers Shown and Hidden and keeps the choice on this device", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Body · Intake/, "Hidden");
    expect(localStorage.getItem("belay.weekIntake")).toBe("hidden");
    expect(await screen.findByRole("combobox", { name: "Body · Intake · Hidden" })).toBeTruthy();
    expect(localStorage.getItem("belay.rangePill")).toBeNull();
    await choose(/^Body · Intake/, "Shown");
    expect(localStorage.getItem("belay.weekIntake")).toBe("shown");
  });

  it("says the range and intake rows in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Corps · Fourchette/, "Masquée");
    expect(
      await screen.findByRole("combobox", { name: "Corps · Fourchette · Masquée" }),
    ).toBeTruthy();
    await choose(/^Corps · Fourchette/, "Affichée");
    expect(localStorage.getItem("belay.rangePill")).toBe("shown");
    await choose(/^Corps · Apports/, "Masqués");
    expect(await screen.findByRole("combobox", { name: "Corps · Apports · Masqués" })).toBeTruthy();
    await choose(/^Corps · Apports/, "Affichés");
    expect(localStorage.getItem("belay.weekIntake")).toBe("shown");
  });

  it("History offers With activities and Sessions only and keeps the choice on this device", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Sessions · History/, "Sessions only");
    expect(localStorage.getItem("belay.historyActivities")).toBe("hidden");
    expect(
      await screen.findByRole("combobox", { name: "Sessions · History · Sessions only" }),
    ).toBeTruthy();
    expect(localStorage.getItem("belay.sessionVolume")).toBeNull();
    await choose(/^Sessions · History/, "With activities");
    expect(localStorage.getItem("belay.historyActivities")).toBe("shown");
  });

  it("Volume offers Shown and Hidden and keeps the choice on this device", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Sessions · Volume/, "Hidden");
    expect(localStorage.getItem("belay.sessionVolume")).toBe("hidden");
    expect(
      await screen.findByRole("combobox", { name: "Sessions · Volume · Hidden" }),
    ).toBeTruthy();
    expect(localStorage.getItem("belay.historyActivities")).toBeNull();
    await choose(/^Sessions · Volume/, "Shown");
    expect(localStorage.getItem("belay.sessionVolume")).toBe("shown");
  });

  it("says the history and volume rows in French", async () => {
    await i18n.changeLanguage("fr");
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^Séances · Historique/, "Séances seules");
    expect(
      await screen.findByRole("combobox", { name: "Séances · Historique · Séances seules" }),
    ).toBeTruthy();
    await choose(/^Séances · Historique/, "Avec activités");
    expect(localStorage.getItem("belay.historyActivities")).toBe("shown");
    await choose(/^Séances · Volume/, "Masqué");
    expect(await screen.findByRole("combobox", { name: "Séances · Volume · Masqué" })).toBeTruthy();
    await choose(/^Séances · Volume/, "Affiché");
    expect(localStorage.getItem("belay.sessionVolume")).toBe("shown");
  });

  it("switches the language from its menu", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^General · Language/, "Français");
    expect(i18n.language).toBe("fr");
    expect(
      await screen.findByRole("combobox", { name: "Général · Langue · Français" }),
    ).toBeTruthy();
  });

  it("applies and keeps the theme from its menu", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await choose(/^General · Theme/, "Dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("belay.theme")).toBe("dark");
    expect(screen.getByRole("combobox", { name: "General · Theme · Dark" })).toBeTruthy();
  });

  it("offers exactly today's preferences", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    await screen.findByRole("region", { name: "General" });
    expect(screen.getAllByRole("combobox")).toHaveLength(8);
    for (const role of ["combobox", "button", "link"] as const)
      expect(screen.queryByRole(role, { name: /Units|Unités|Sources/ })).toBeNull();
  });

  it("signed out: preferences and version only", async () => {
    version.current = "0.5.0";
    fakeApi({ me: null });
    renderRoute("/settings");
    await screen.findByRole("region", { name: "General" });
    for (const [name] of SECTIONS) expect(screen.getByRole("region", { name })).toBeTruthy();
    await screen.findByRole("link", { name: /^Belay 0\.5\.0/ });
    expect(screen.queryByRole("link", { name: /Profile/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});

describe("Settings page end", () => {
  // The section's last child, which holds what closes the page.
  const pageEnd = async () =>
    (await screen.findByRole("region", { name: "General" })).parentElement!.closest("section")!
      .lastElementChild!;

  it("the sign-out group and the version line close the page, the version last", async () => {
    version.current = "0.5.0";
    signedIn(async () => Response.json({ redirectTo: idp }));
    const signOut = await signOutButton();
    const end = await pageEnd();
    const link = screen.getByRole("link", { name: /^Belay 0\.5\.0/ });
    expect(end.contains(signOut)).toBe(true);
    expect(end.contains(link)).toBe(true);
    expect(signOut.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(end.lastElementChild!.contains(link)).toBe(true);
  });

  it("signed out: the version line sits alone at the page's end", async () => {
    version.current = "0.5.0";
    fakeApi({ me: null });
    renderRoute("/settings");
    const link = await screen.findByRole("link", { name: /^Belay 0\.5\.0/ });
    const end = await pageEnd();
    // The same end as signed in, holding the version line alone.
    expect(end).not.toBe(link.closest("p"));
    expect(end.children).toHaveLength(1);
    expect(end.firstElementChild).toBe(link.closest("p"));
  });
});

describe("Settings account rows", () => {
  const SUPPLEMENT_A = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e01";
  const SUPPLEMENT_B = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7e02";
  const at = "2026-10-05T06:30:00.000Z";

  it("shows its groups in order", async () => {
    version.current = "0.5.0";
    signedIn(async () => Response.json({ redirectTo: idp }));
    const signOut = await signOutButton();
    const order = [
      screen.getByRole("link", { name: /^Ada/ }),
      screen.getByRole("region", { name: "General" }),
      screen.getByRole("region", { name: "Home" }),
      screen.getByRole("region", { name: "Sessions" }),
      screen.getByRole("region", { name: "Body" }),
      screen.getByRole("region", { name: "Tracking" }),
      signOut,
      screen.getByRole("link", { name: /^Belay 0\.5\.0/ }),
    ];
    order
      .slice(1)
      .forEach((after, i) =>
        expect(order[i]!.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      );
  });

  it("opens Profil from a row that shows the name and what Profil holds", async () => {
    fakeApi({ me: ADA });
    renderRoute("/settings");
    const link = await screen.findByRole("link", { name: "Ada Profile · height, age, loss range" });
    expect(link.getAttribute("href")).toBe("/settings/profile");
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "Profile" })).toBeTruthy();
  });

  it("falls back to « Profile » and a person icon without a name", async () => {
    fakeApi({ me: { ...ADA, displayName: "" } });
    renderRoute("/settings");
    const link = await screen.findByRole("link", {
      name: "Profile Profile · height, age, loss range",
    });
    expect(link.querySelector("svg.lucide-user-round")).toBeTruthy();
  });

  it("counts the supplements on the list in the Compléments row and opens the list", async () => {
    await seed(ADA.id, [
      { kind: "supplement", id: SUPPLEMENT_A, field: "name", value: "Zinc", at },
      { kind: "supplement", id: SUPPLEMENT_B, field: "name", value: "Iron", at },
      { kind: "supplement", id: SUPPLEMENT_B, field: "removed", value: true, at },
    ]);
    fakeApi({ me: ADA });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Tracking" });
    const link = await within(list).findByRole("link", { name: "Supplements 1 on your list" });
    expect(link.getAttribute("href")).toBe("/settings/supplements");
    fireEvent.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: "My supplements" })).toBeTruthy();
  });

  it("offers exactly today's account rows", async () => {
    signedIn(async () => Response.json({ redirectTo: idp }));
    await signOutButton();
    const main = screen.getByRole("main");
    const hrefs = within(main)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"))
      .filter((h) => h?.startsWith("/settings/"));
    expect(hrefs).toEqual(["/settings/profile", "/settings/supplements"]);
    expect(
      within(main)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Sign out"]);
  });
});

describe("Settings sign-out", () => {
  // The sheet hands the focus back to what opened it; a browser focuses a tapped button.
  async function openSheet(name = "Sign out", title = "Sign out?") {
    const row = await screen.findByRole("button", { name });
    act(() => row.focus());
    fireEvent.click(row);
    return { row, sheet: await screen.findByRole("dialog", { name: title }) };
  }

  it("is not offered to someone signed out", async () => {
    fakeApi({ me: null });
    renderRoute("/settings");
    await screen.findByRole("heading", { name: "Settings" });
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("navigates to the redirectTo the server returns, and forgets the account", async () => {
    const api = signedIn(async () => Response.json({ redirectTo: idp }));
    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
    expect(logoutCalls(api)).toHaveLength(1);
    expect(readLastUser()).toBeNull();
  });

  it("with nothing waiting, still asks first and says nothing is waiting", async () => {
    const api = signedIn(async () => Response.json({ redirectTo: idp }));
    const { sheet } = await openSheet();
    expect(sheet.textContent).toContain("Nothing is waiting to be sent.");
    expect(logoutCalls(api)).toHaveLength(0);
    const action = within(sheet).getByRole("button", { name: "Sign out" });
    expect(action.className).toContain("text-destructive");
    fireEvent.click(action);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
  });

  it.each([
    [
      "the server answers with a non-JSON error",
      async () => new Response("Bad Gateway", { status: 502 }),
    ],
    [
      "the request itself fails (offline)",
      async (): Promise<Response> => {
        throw new TypeError("Failed to fetch");
      },
    ],
  ])(
    "when %s, closes the sheet, says why under the row and gives it the focus",
    async (_, logout) => {
      signedIn(logout);
      const { row, sheet } = await openSheet();
      fireEvent.click(within(sheet).getByRole("button", { name: "Sign out" }));
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe("Couldn't sign you out. Check your connection and try again.");
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(row.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      await waitFor(() => expect(document.activeElement).toBe(row));
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it("never navigates to undefined when redirectTo is missing", async () => {
    signedIn(async () => Response.json({}));
    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("sends a single POST when the sheet's red action is clicked twice", async () => {
    let finish!: (r: Response) => void;
    const api = signedIn(() => new Promise<Response>((resolve) => (finish = resolve)));
    const { row, sheet } = await openSheet();
    const action = within(sheet).getByRole("button", { name: "Sign out" });
    fireEvent.click(action);
    fireEvent.click(action);
    await waitFor(() => expect((row as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(row);
    expect(screen.queryByRole("dialog")).toBeNull();
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
    const first = await openSheet();
    expect(first.sheet.textContent).toContain(
      "2 entries not sent yet: they will go at your next sign-in on this device.",
    );
    expect(logoutCalls(api)).toHaveLength(0);
    fireEvent.click(within(first.sheet).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(logoutCalls(api)).toHaveLength(0);
    const { sheet } = await openSheet();
    fireEvent.click(within(sheet).getByRole("button", { name: "Sign out anyway" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
  });

  it("starts on Cancel, and Cancel gives the focus back to Sign out", async () => {
    await seed(ADA.id, [weight("2026-10-07", 79.8)]);
    signedIn(
      async () => Response.json({ redirectTo: idp }),
      async () => new Response(null, { status: 503 }),
    );
    const { row, sheet } = await openSheet();
    const cancel = within(sheet).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.click(cancel);
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("still offers sign-out when the local read fails, always asking first", async () => {
    vi.mocked(pendingCounts).mockRejectedValue(new DOMException("lost", "InvalidStateError"));
    const api = signedIn(async () => Response.json({ redirectTo: idp }));
    const { sheet } = await openSheet();
    expect(sheet.textContent).toContain(
      "Some entries may not have been sent yet: they will go at your next sign-in on this device.",
    );
    expect(logoutCalls(api)).toHaveLength(0);
    fireEvent.click(within(sheet).getByRole("button", { name: "Sign out anyway" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
  });

  it("never says nothing is waiting when the local database cannot open", async () => {
    vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("The user denied permission", "SecurityError");
    });
    signedIn(async () => Response.json({ redirectTo: idp }));
    const { sheet } = await openSheet();
    expect(sheet.textContent).toContain(
      "Some entries may not have been sent yet: they will go at your next sign-in on this device.",
    );
    expect(within(sheet).getByRole("button", { name: "Sign out anyway" })).toBeTruthy();
  });

  it("says it in French, with the narrow space before the colon", async () => {
    await i18n.changeLanguage("fr");
    vi.mocked(pendingCounts).mockRejectedValue(new DOMException("lost", "InvalidStateError"));
    signedIn(async () => Response.json({ redirectTo: idp }));
    const { sheet } = await openSheet("Se déconnecter", "Se déconnecter\u202f?");
    expect(sheet.textContent).toContain(
      "Des saisies n'ont peut-être pas encore été envoyées\u202f: elles partiront à ta prochaine connexion sur cet appareil.",
    );
    expect(within(sheet).getByRole("button", { name: "Se déconnecter quand même" })).toBeTruthy();
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
    const items = within(list).getAllByRole("listitem");
    expect(items[0]!.textContent).toMatch(/Weigh-in for \w{3}, Oct 5/);
    expect(items[0]!.textContent).toContain("Refused by the server");
    expect(items[1]!.textContent).toContain("Loss range");
    expect(items[1]!.textContent).toContain("Not found on the server");
    const described = within(list).getByRole("list").getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(document.getElementById(described!)?.textContent).toBe(
      "The server refused them, so they are no longer waiting. Enter them again if you need to.",
    );
    fireEvent.click(within(list).getByRole("button", { name: "Clear the list" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Refused entries" })).toBeNull(),
    );
  });

  it("refused entries sit right under the profile row", async () => {
    await seed(ADA.id, [weight("2026-10-05", 80)]);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({ rejected: r.changes.map((_, index) => ({ index, reason: "refused" })) }),
        ),
    });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Refused entries" });
    const profile = screen.getByRole("link", { name: /^Ada/ });
    const preferences = screen.getByRole("region", { name: "General" });
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(profile.compareDocumentPosition(list) & following).toBe(following);
    expect(list.compareDocumentPosition(preferences) & following).toBe(following);
  });

  const SUPPLEMENT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d01";
  const ANNOTATION = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d02";
  const at = "2026-10-05T06:30:00.000Z";
  const day = "2026-10-05";
  const WORKOUT = "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d03";
  const start: Change = {
    kind: "workout",
    id: WORKOUT,
    field: "start",
    sessionCode: "A",
    plan: [...sessionByCode("A")!.slots],
    startedAt: at,
    at,
  };
  const create: Change = {
    kind: "set",
    id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d04",
    workoutId: WORKOUT,
    field: "create",
    slotIndex: 0,
    position: 3,
    exerciseId: "ds:0025",
    warmup: false,
    weightKg: 80,
    reps: 8,
    rir: 1,
    doneAt: at,
    at,
  };
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
    ["steps", [{ kind: "steps", date: day, value: 8400, at }], "steps", "Steps for", "Pas du"],
    [
      "activity",
      [
        {
          kind: "activity",
          id: ANNOTATION,
          field: "fields",
          date: day,
          type: "cardio",
          durationMin: 45,
          cardioType: "bike",
          climbStyle: null,
          climbRuns: null,
          climbGrade: null,
          climbColor: null,
          at,
        },
      ],
      "activity",
      "Activity on",
      "Activité du",
    ],
    ["session", [start], "workout", "Session on", "Séance du"],
    ["set", [start, create], "set", "Set on", "Série du"],
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

  it("says why a set was refused", async () => {
    await seed(ADA.id, [start, create]);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({
            rejected: r.changes.flatMap((c, index) =>
              c.kind === "set" ? [{ index, reason: "unknown_exercise" as const }] : [],
            ),
          }),
        ),
    });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Refused entries" });
    expect(list.textContent).toContain("Exercise unknown to the server");
  });

  it("says why a set counted in the wrong measure was refused", async () => {
    await seed(ADA.id, [start, create]);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({
            rejected: r.changes.flatMap((c, index) =>
              c.kind === "set" ? [{ index, reason: "wrong_measure" as const }] : [],
            ),
          }),
        ),
    });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Refused entries" });
    expect(list.textContent).toContain(
      "Counted in reps for a timed exercise, or the other way round",
    );
  });

  it("says plainly why a shorter session plan was refused, in both languages", async () => {
    await seed(ADA.id, [start]);
    fakeApi({
      me: ADA,
      sync: async (r) =>
        Response.json(
          answer({
            rejected: r.changes.flatMap((c, index) =>
              c.kind === "workout" ? [{ index, reason: "plan_shrank" as const }] : [],
            ),
          }),
        ),
    });
    renderRoute("/settings");
    const list = await screen.findByRole("region", { name: "Refused entries" });
    expect(list.textContent).toContain(
      "Fewer exercises than the stored session (an exercise is never removed)",
    );
    cleanup();
    await i18n.changeLanguage("fr");
    renderRoute("/settings");
    const liste = await screen.findByRole("region", { name: "Saisies refusées" });
    expect(liste.textContent).toContain(
      "Moins d'exercices que la séance enregistrée (un exercice n'est jamais retiré)",
    );
  });

  it("is not shown when the server refused nothing", async () => {
    signedIn(async () => Response.json({ redirectTo: idp }));
    await signOutButton();
    expect(screen.queryByRole("region", { name: "Refused entries" })).toBeNull();
  });
});

// The version is stamped at build time: forced here so the tests never depend on the environment.
const version = vi.hoisted(() => ({ current: "0.3.0-rc.2" }));
vi.mock("../lib/version", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/version")>();
  return {
    ...real,
    get APP_VERSION() {
      return version.current;
    },
  };
});

describe("Settings version", () => {
  it("links a release version to its notes", async () => {
    version.current = "0.5.0";
    fakeApi({ me: null });
    renderRoute("/settings");
    const link = await screen.findByRole("link", {
      name: "Belay 0.5.0 · release notes (new tab)",
    });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/MorganKryze/belay/releases/tag/v0.5.0",
    );
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toContain("Belay 0.5.0");
  });

  it("speaks French", async () => {
    version.current = "0.5.0";
    await i18n.changeLanguage("fr");
    fakeApi({ me: null });
    renderRoute("/settings");
    await screen.findByRole("link", {
      name: "Belay 0.5.0 · notes de version (nouvel onglet)",
    });
  });

  it("is plain text on a dev build", async () => {
    version.current = "dev";
    fakeApi({ me: null });
    renderRoute("/settings");
    await screen.findByText("Belay dev");
    expect(screen.queryByRole("link", { name: /Release notes/ })).toBeNull();
  });
});
