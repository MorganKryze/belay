import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { Home } from "./home";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderHome(response: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(response));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <Home />
    </QueryClientProvider>,
  );
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
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <Home />
      </QueryClientProvider>,
    );
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
