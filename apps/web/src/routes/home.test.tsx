import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
