import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { routeTree } from "../router";

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

// The real route tree on an in-memory history: Home reads its search params from the router.
function mount(url = "/") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function renderHome(response: () => Promise<Response>, url = "/") {
  vi.stubGlobal("fetch", vi.fn(response));
  return mount(url);
}

describe("Home", () => {
  it("offers sign-in when the session is missing or expired", async () => {
    renderHome(async () => new Response(null, { status: 401 }));
    const link = await screen.findByRole("link", { name: "Sign in" });
    expect(link.getAttribute("href")).toBe("/auth/login?returnTo=%2F");
  });

  it("greets the signed-in user", async () => {
    renderHome(async () => Response.json({ id: "1", displayName: "Alex" }));
    expect(await screen.findByText("Hello, Alex")).toBeTruthy();
  });

  it("says the server is unreachable instead of crashing", async () => {
    renderHome(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await screen.findByText("Can't reach the server right now.")).toBeTruthy();
  });
});

describe("Home sign-in failure", () => {
  const signedOut = async () => new Response(null, { status: 401 });

  it.each([
    ["unavailable", "Sign-in is unavailable right now. Try again in a moment."],
    ["expired", "Your sign-in took too long. Please try again."],
    ["failed", "Sign-in didn't work. Please try again."],
  ])(
    "?signin=%s shows a localized alert, with the Sign in link still there",
    async (reason, text) => {
      renderHome(signedOut, `/?signin=${reason}`);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(text);
      expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    },
  );

  it("speaks French when the app is in French", async () => {
    await i18n.changeLanguage("fr");
    renderHome(signedOut, "/?signin=expired");
    expect((await screen.findByRole("alert")).textContent).toBe(
      "La connexion a pris trop de temps. Réessaie.",
    );
  });

  it("removes the param from the URL but keeps the message, so a reload shows nothing", async () => {
    const router = renderHome(signedOut, "/?signin=failed");
    await screen.findByRole("alert");
    await waitFor(() => expect(router.history.location.search).toBe(""));
    expect(screen.getByRole("alert").textContent).toBe("Sign-in didn't work. Please try again.");
  });

  it("ignores an unknown reason: no message, and the param is dropped anyway", async () => {
    const router = renderHome(signedOut, "/?signin=<b>hacked</b>");
    await screen.findByRole("link", { name: "Sign in" });
    await waitFor(() => expect(router.history.location.search).toBe(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/hacked/)).toBeNull();
  });

  it("shows no failure to someone who is signed in", async () => {
    renderHome(async () => Response.json({ id: "1", displayName: "Alex" }), "/?signin=failed");
    await screen.findByText("Hello, Alex");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows nothing without the param", async () => {
    renderHome(signedOut);
    await screen.findByRole("link", { name: "Sign in" });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("Home sign-out", () => {
  const assign = vi.fn();
  const idp = "https://idp.example/logout";

  // Signed-in session; `logoutResponse` is what POST /auth/logout answers.
  function renderSignedIn(logoutResponse: () => Promise<Response>) {
    assign.mockClear();
    vi.stubGlobal("location", { assign });
    const fetchMock = vi.fn(async (url: string) =>
      url === "/auth/logout" ? logoutResponse() : Response.json({ id: "1", displayName: "Alex" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mount();
    return fetchMock;
  }

  const clickSignOut = async () =>
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
  const logoutCalls = (f: ReturnType<typeof renderSignedIn>) =>
    f.mock.calls.filter(([url]) => url === "/auth/logout");

  it("navigates to the redirectTo the server returns", async () => {
    const f = renderSignedIn(async () => Response.json({ redirectTo: idp }));
    await clickSignOut();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(idp));
    expect(f).toHaveBeenCalledWith("/auth/logout", expect.objectContaining({ method: "POST" }));
  });

  it("shows an alert and stays put when the server answers with a non-JSON error", async () => {
    renderSignedIn(async () => new Response("Bad Gateway", { status: 502 }));
    await clickSignOut();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/Couldn't sign you out/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows an alert when the request itself fails (offline)", async () => {
    renderSignedIn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await clickSignOut();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("never navigates to undefined when redirectTo is missing", async () => {
    renderSignedIn(async () => Response.json({}));
    await clickSignOut();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("sends a single POST when the button is clicked twice", async () => {
    let finish!: (r: Response) => void;
    const f = renderSignedIn(() => new Promise<Response>((resolve) => (finish = resolve)));
    await clickSignOut();
    const button = screen.getByRole("button", { name: "Sign out" });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(button);
    expect(logoutCalls(f)).toHaveLength(1);
    finish(Response.json({ redirectTo: idp }));
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
  });
});
