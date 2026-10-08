import type { SyncRequest, WeightRow } from "@belay/shared/sync/schema";
import type { Page } from "@playwright/test";

export const ADA = { id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8e", displayName: "Ada" };

// The API behind page.route: /api/me answers Ada, /api/sync merges weigh-ins like the real
// server (the later write wins per day) and sends back what changed since the cursor. Flip
// `offline` to make every call fail, `session` to answer 401.
export async function fakeServer(
  page: Page,
  { rows = [] as { date: string; weightKg: number }[] } = {},
) {
  const state = {
    offline: false,
    session: "live" as "live" | "expired",
    requests: [] as SyncRequest[],
    rows: new Map<string, WeightRow & { seq: number }>(),
  };
  let seq = 0;
  for (const r of rows) state.rows.set(r.date, { ...r, at: `${r.date}T05:00:00.000Z`, seq: ++seq });

  await page.route("**/api/me", (route) =>
    state.offline
      ? route.abort("internetdisconnected")
      : state.session === "live"
        ? route.fulfill({ json: ADA })
        : route.fulfill({ status: 401 }),
  );
  await page.route("**/api/sync", (route) => {
    if (state.offline) return route.abort("internetdisconnected");
    const request = route.request().postDataJSON() as SyncRequest;
    state.requests.push(request);
    if (state.session === "expired") return route.fulfill({ status: 401 });
    for (const c of request.changes) {
      if (c.kind !== "weight") continue;
      const stored = state.rows.get(c.date);
      if (!stored || Date.parse(c.at) > Date.parse(stored.at))
        state.rows.set(c.date, { date: c.date, weightKg: c.weightKg, at: c.at, seq: ++seq });
    }
    const since = [...state.rows.values()].filter((r) => r.seq > Number(request.cursor));
    return route.fulfill({
      json: {
        cursor: String(Math.max(Number(request.cursor), ...since.map((r) => r.seq))),
        weights: since.map((r) => ({ date: r.date, weightKg: r.weightKg, at: r.at })),
        measures: [],
        intake: [],
        supplements: [],
        supplementLogs: [],
        annotations: [],
        target: null,
        profile: null,
        rejected: [],
        hasMore: false,
      },
    });
  });
  return state;
}

// Four ISO weeks around Wednesday 7 October 2026: insufficient, valid after an insufficient
// one, valid in the default range (0.7 %), and the week in progress.
export const WEEKS = [
  ...["2026-09-14", "2026-09-15", "2026-09-16"].map((date) => ({ date, weightKg: 81 })),
  ...["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"].map((date) => ({
    date,
    weightKg: 80.8,
  })),
  ...["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].map((date) => ({
    date,
    weightKg: 80.2,
  })),
  { date: "2026-10-05", weightKg: 80 },
  { date: "2026-10-06", weightKg: 79.9 },
];
