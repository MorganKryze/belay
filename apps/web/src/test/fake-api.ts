import { mergeWeights } from "@belay/shared/sync/merge";
import type { SyncRequest, SyncResponse, WeightRow } from "@belay/shared/sync/schema";
import { vi } from "vitest";
import type { Me } from "@/lib/api";

// A stand-in for the server behind fetch: /api/me, /auth/logout, and an /api/sync that merges
// weigh-ins like the real one (last write wins per day), answers 401 without a session and 409
// for another account's queue. `me: "down"` fails every request, as offline.
export function fakeApi({
  me = null,
  sync,
  logout = async () => Response.json({ redirectTo: "https://idp.example/logout" }),
}: {
  me?: Me | null | "down";
  sync?: (request: SyncRequest) => Response | Promise<Response>;
  logout?: () => Promise<Response>;
} = {}) {
  const rows = new Map<string, WeightRow & { seq: number }>();
  let seq = 0;
  const server = (request: SyncRequest): SyncResponse => {
    const weights = request.changes.flatMap((c) => (c.kind === "weight" ? [c] : []));
    const stored = new Map([...rows].map(([date, r]) => [date, r.at]));
    for (const c of mergeWeights(stored, weights, new Date()))
      rows.set(c.date, { date: c.date, weightKg: c.weightKg, at: c.at, seq: ++seq });
    const since = [...rows.values()].filter((r) => r.seq > Number(request.cursor));
    return {
      cursor: String(Math.max(Number(request.cursor), ...since.map((r) => r.seq))),
      weights: since.map((r) => ({ date: r.date, weightKg: r.weightKg, at: r.at })),
      target: null,
      hasMore: false,
    };
  };
  const requests: SyncRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (me === "down") throw new TypeError("Failed to fetch"); // no network, or no server
    if (url === "/api/me") return me ? Response.json(me) : new Response(null, { status: 401 });
    if (url === "/api/sync") {
      const request = JSON.parse(String(init?.body)) as SyncRequest;
      requests.push(request);
      if (sync) return sync(request);
      if (me === null) return new Response(null, { status: 401 });
      if (request.account !== me.id) return new Response(null, { status: 409 });
      return Response.json(server(request));
    }
    if (url === "/auth/logout") return logout();
    throw new Error(`unexpected request to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requests, rows, server };
}
