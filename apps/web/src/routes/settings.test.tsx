import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { readLastUser } from "../sync/last-user";
import { fakeApi } from "../test/fake-api";
import { renderRoute } from "../test/render-route";
import { ADA, seed, weight } from "../test/seed";

const assign = vi.fn();
const idp = "https://idp.example/logout";

beforeEach(() => {
  indexedDB = new IDBFactory();
  assign.mockClear();
  vi.stubGlobal("location", { ...window.location, assign });
});
afterEach(async () => {
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
});
