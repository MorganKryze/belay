import { isCreatineName } from "@belay/shared/body/supplements";
import type { Change, SyncRequest, WeightRow } from "@belay/shared/sync/schema";
import type { Page } from "@playwright/test";

export const ADA = { id: "0199c3a2-7b1e-7cc0-8f3e-2d4b5a6c7d8e", displayName: "Ada" };

type Row = Record<string, unknown> & { seq: number };
// A row as the answer carries it: without the fake's own sequence number.
const bare = (row: Row) => Object.fromEntries(Object.entries(row).filter(([k]) => k !== "seq"));

// The API behind page.route: /api/me answers Ada, /api/sync merges like the real server (the
// later write wins, field by field) and sends back what changed since the cursor. Flip
// `offline` to make every call fail, `session` to answer 401. `changes` are entries already on
// the server, as another device would have sent them.
export async function fakeServer(
  page: Page,
  { rows = [] as { date: string; weightKg: number }[], changes = [] as Change[] } = {},
) {
  const state = {
    offline: false,
    session: "live" as "live" | "expired",
    requests: [] as SyncRequest[],
    rows: new Map<string, WeightRow & { seq: number }>(),
    // Every other table, by its key: "measures|2026-10-06", "supplements|<id>", "profile".
    other: new Map<string, Row>(),
  };
  let seq = 0;
  for (const r of rows) state.rows.set(r.date, { ...r, at: `${r.date}T05:00:00.000Z`, seq: ++seq });

  const apply = (c: Change) => {
    const later = (key: string, at: string) => {
      const stored = state.other.get(key)?.[at] as string | null | undefined;
      return !stored || Date.parse(c.at) > Date.parse(stored);
    };
    const write = (key: string, empty: Record<string, unknown>, patch: Record<string, unknown>) => {
      state.other.set(key, { ...empty, ...state.other.get(key), ...patch, seq: ++seq });
    };
    switch (c.kind) {
      case "weight": {
        const stored = state.rows.get(c.date);
        if (!stored || Date.parse(c.at) > Date.parse(stored.at))
          state.rows.set(c.date, { date: c.date, weightKg: c.weightKg, at: c.at, seq: ++seq });
        return;
      }
      case "measure": {
        const key = `measures|${c.date}`;
        const [v, a] = {
          waist: ["waistCm", "waistAt"],
          neck: ["neckCm", "neckAt"],
          hip: ["hipCm", "hipAt"],
        }[c.field];
        if (later(key, a!))
          write(
            key,
            {
              date: c.date,
              waistCm: null,
              waistAt: null,
              neckCm: null,
              neckAt: null,
              hipCm: null,
              hipAt: null,
            },
            { [v!]: c.value, [a!]: c.at },
          );
        return;
      }
      case "intake": {
        const key = `intake|${c.date}`;
        const [v, a] = c.field === "kcal" ? ["kcal", "kcalAt"] : ["proteinG", "proteinAt"];
        if (later(key, a))
          write(
            key,
            { date: c.date, kcal: null, kcalAt: null, proteinG: null, proteinAt: null },
            { [v]: c.value, [a]: c.at },
          );
        return;
      }
      case "profile": {
        const [v, a] = {
          formula: ["formula", "formulaAt"],
          birthYear: ["birthYear", "birthYearAt"],
          height: ["heightCm", "heightAt"],
        }[c.field];
        if (later("profile", a!))
          write(
            "profile",
            {
              formula: null,
              formulaAt: null,
              birthYear: null,
              birthYearAt: null,
              heightCm: null,
              heightAt: null,
            },
            { [v!]: c.value, [a!]: c.at },
          );
        return;
      }
      case "supplement": {
        const key = `supplements|${c.id}`;
        const created = state.other.has(key);
        if (c.field === "name" && later(key, "nameAt"))
          write(
            key,
            {
              id: c.id,
              kind: isCreatineName(c.value) ? "creatine" : "other",
              removed: false,
              removedAt: null,
            },
            { name: c.value, nameAt: c.at },
          );
        if (c.field === "removed" && created && later(key, "removedAt"))
          write(key, {}, { removed: c.value, removedAt: c.at });
        return;
      }
      case "supplementLog": {
        const key = `supplementLogs|${c.supplementId}|${c.date}`;
        if (later(key, "at"))
          write(key, {}, { supplementId: c.supplementId, date: c.date, taken: c.taken, at: c.at });
        return;
      }
      case "annotation": {
        const key = `annotations|${c.id}`;
        if (c.field === "fields" && later(key, "fieldsAt"))
          write(
            key,
            { id: c.id, removed: false, removedAt: null },
            { date: c.date, type: c.type, label: c.label, fieldsAt: c.at },
          );
        if (c.field === "removed" && state.other.has(key) && later(key, "removedAt"))
          write(key, {}, { removed: c.value, removedAt: c.at });
        return;
      }
      default:
        return;
    }
  };
  for (const c of changes) apply(c);

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
    for (const c of request.changes) apply(c);
    const cursor = Number(request.cursor);
    const since = [...state.rows.values()].filter((r) => r.seq > cursor);
    const other = [...state.other].filter(([, r]) => r.seq > cursor);
    const table = (name: string) =>
      other.filter(([k]) => k.startsWith(`${name}|`)).map(([, r]) => bare(r));
    const profile = other.find(([k]) => k === "profile")?.[1];
    return route.fulfill({
      json: {
        cursor: String(
          Math.max(cursor, ...since.map((r) => r.seq), ...other.map(([, r]) => r.seq)),
        ),
        weights: since.map((r) => ({ date: r.date, weightKg: r.weightKg, at: r.at })),
        measures: table("measures"),
        intake: table("intake"),
        supplements: table("supplements"),
        supplementLogs: table("supplementLogs"),
        annotations: table("annotations"),
        target: null,
        profile: profile ? bare(profile) : null,
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
