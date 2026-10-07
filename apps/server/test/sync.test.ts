import type { Change, SyncResponse } from "@belay/shared/sync/schema";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { asUser } from "../src/db/client";
import { createSession, upsertUser } from "../src/db/identity";
import { bodyMetrics } from "../src/db/schema";
import { testEnv } from "./config";
import { testDb } from "./db";

const { db } = testDb();
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });

const AT = "2026-10-07T06:30:00.000Z";
const LATER = "2026-10-07T06:31:00.000Z";
const weight = (date: string, weightKg: number | null, at = AT): Change => ({
  kind: "weight",
  date,
  weightKg,
  at,
});

// The account each session cookie belongs to, which the phone names in every request.
const accounts = new Map<string, string>();

async function signIn(sub: string) {
  const user = await upsertUser(db, { issuer: "https://idp.test", sub, displayName: sub });
  const token = newSessionToken();
  await createSession(db, hashToken(token), user, 30);
  const cookie = `${SESSION_COOKIE}=${token}`;
  accounts.set(cookie, user);
  return { user, cookie };
}

function post(cookie: string | null, body: string) {
  return app.request("/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body,
  });
}

const body = (cookie: string, cursor: string, changes: unknown[], extra = {}) =>
  JSON.stringify({ account: accounts.get(cookie), cursor, changes, ...extra });

async function sync(cookie: string, cursor: string, changes: unknown[] = []) {
  const res = await post(cookie, body(cookie, cursor, changes));
  expect(res.status).toBe(200);
  return (await res.json()) as SyncResponse;
}

const rowsOf = (user: string) =>
  asUser(db, user, (tx) => tx.select().from(bodyMetrics).where(eq(bodyMetrics.userId, user)));

describe("POST /api/sync", () => {
  it("stores a weigh-in and sends it back with a new cursor and the default range", async () => {
    const { cookie } = await signIn("sync-first");
    const res = await sync(cookie, "0", [weight("2026-10-07", 79.8)]);
    expect(res.weights).toEqual([{ date: "2026-10-07", weightKg: 79.8, at: AT }]);
    expect(res.target).toEqual({ minPct: 0.5, maxPct: 1, at: null });
    expect(res.hasMore).toBe(false);
    expect(BigInt(res.cursor)).toBeGreaterThan(0n);
  });

  it("lets the later write win, keeps the stored value on a tie, and clamps a future time", async () => {
    const { cookie } = await signIn("sync-lww");
    const { cursor } = await sync(cookie, "0", [weight("2026-10-07", 80, LATER)]);
    const older = await sync(cookie, cursor, [weight("2026-10-07", 81, AT)]);
    expect(older.weights).toEqual([]);
    const tie = await sync(cookie, cursor, [weight("2026-10-07", 82, LATER)]);
    expect(tie.weights).toEqual([]);

    const before = Date.now();
    const future = await sync(cookie, cursor, [
      weight("2026-10-07", 79, "2099-01-01T00:00:00.000Z"),
    ]);
    expect(future.weights).toHaveLength(1);
    expect(future.weights[0]!.weightKg).toBe(79);
    expect(Date.parse(future.weights[0]!.at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(future.weights[0]!.at)).toBeLessThanOrEqual(Date.now());
  });

  it("keeps one row when two devices weigh the same day", async () => {
    const { user, cookie } = await signIn("sync-two-devices");
    await sync(cookie, "0", [weight("2026-10-07", 80, AT)]);
    const second = await sync(cookie, "0", [weight("2026-10-07", 79.6, LATER)]);
    expect(second.weights).toEqual([{ date: "2026-10-07", weightKg: 79.6, at: LATER }]);
    expect(await rowsOf(user)).toHaveLength(1);
  });

  it("changes neither the data nor the cursor when a batch is replayed", async () => {
    const { user, cookie } = await signIn("sync-replay");
    const batch = [
      weight("2026-10-06", 80.2),
      weight("2026-10-07", 80),
      weight("2026-10-07", 79.8, LATER),
    ];
    const first = await sync(cookie, "0", batch);
    const rows = await rowsOf(user);
    const replay = await sync(cookie, first.cursor, batch);
    expect(replay).toEqual({ cursor: first.cursor, weights: [], target: null, hasMore: false });
    expect(await rowsOf(user)).toEqual(rows);
  });

  it("sends only what changed after the cursor, then pages beyond 1 000 rows", async () => {
    const { user, cookie } = await signIn("sync-paging");
    const start = await sync(cookie, "0");
    await db.insert(bodyMetrics).values(
      Array.from({ length: 1001 }, (_, i) => ({
        userId: user,
        date: new Date(Date.UTC(2020, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
        weightKg: 80,
        weightAt: new Date(AT),
      })),
    );
    const page1 = await sync(cookie, start.cursor);
    expect(page1.weights).toHaveLength(1000);
    expect(page1.hasMore).toBe(true);
    const page2 = await sync(cookie, page1.cursor);
    expect(page2.weights).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
    expect(page2.weights[0]!.date).toBe("2022-09-27"); // the 1 001st day from 1 January 2020
    expect(await sync(cookie, page2.cursor)).toMatchObject({ weights: [], hasMore: false });
  });

  it("tells a second device about a deletion", async () => {
    const { cookie } = await signIn("sync-delete");
    const phone = await sync(cookie, "0", [weight("2026-10-07", 80)]);
    const laptop = await sync(cookie, "0");
    await sync(cookie, phone.cursor, [weight("2026-10-07", null, LATER)]);
    const update = await sync(cookie, laptop.cursor);
    expect(update.weights).toEqual([{ date: "2026-10-07", weightKg: null, at: LATER }]);
  });

  it("syncs the target range under its single timestamp", async () => {
    const { cookie } = await signIn("sync-target");
    const first = await sync(cookie, "0", [
      { kind: "target", minPct: 0.25, maxPct: 0.75, at: LATER },
    ]);
    expect(first.target).toEqual({ minPct: 0.25, maxPct: 0.75, at: LATER });
    const older = await sync(cookie, first.cursor, [
      { kind: "target", minPct: 0.5, maxPct: 1, at: AT },
    ]);
    expect(older.target).toBeNull();
  });

  it("never reads or writes another person's weigh-ins or range", async () => {
    const a = await signIn("sync-auth-a");
    const b = await signIn("sync-auth-b");
    await sync(a.cookie, "0", [
      weight("2026-10-07", 80),
      { kind: "target", minPct: 0.25, maxPct: 0.75, at: AT },
    ]);
    const seenByB = await sync(b.cookie, "0", [weight("2026-10-07", 60, LATER)]);
    expect(seenByB.weights).toEqual([{ date: "2026-10-07", weightKg: 60, at: LATER }]);
    expect(seenByB.target).toEqual({ minPct: 0.5, maxPct: 1, at: null });
    expect((await rowsOf(a.user)).map((r) => r.weightKg)).toEqual([80]);
  });

  it("refuses a queue meant for another account with 409, and writes nothing", async () => {
    const a = await signIn("sync-wrong-a");
    const b = await signIn("sync-wrong-b");
    // B signed in on this browser while A's entries were still queued.
    const res = await post(b.cookie, body(a.cookie, "0", [weight("2026-10-07", 80)]));
    expect(res.status).toBe(409);
    expect(await rowsOf(a.user)).toEqual([]);
    expect(await rowsOf(b.user)).toEqual([]);
  });

  it("serialises concurrent syncs of one person without losing a row", async () => {
    const { cookie } = await signIn("sync-concurrent");
    const days = Array.from({ length: 10 }, (_, i) => `2026-09-${String(i + 10)}`);
    await Promise.all(days.map((d) => sync(cookie, "0", [weight(d, 80)])));
    const all = await sync(cookie, "0");
    expect(all.weights.map((w) => w.date).sort()).toEqual(days);
  });

  it("answers 401 without a session", async () => {
    const res = await post(
      null,
      JSON.stringify({ account: crypto.randomUUID(), cursor: "0", changes: [] }),
    );
    expect(res.status).toBe(401);
  });

  it("refuses an invalid batch with 400 and writes nothing of it", async () => {
    const { user, cookie } = await signIn("sync-invalid");
    const res = await post(
      cookie,
      body(cookie, "0", [weight("2026-10-06", 80), weight("2026-10-07", 401)]),
    );
    expect(res.status).toBe(400);
    expect(await rowsOf(user)).toEqual([]);
    expect((await post(cookie, "{not json")).status).toBe(400);
  });

  it("answers 413 beyond 500 changes or 256 KB", async () => {
    const { cookie } = await signIn("sync-limits");
    const many = Array.from({ length: 501 }, () => weight("2026-10-07", 80));
    expect((await post(cookie, body(cookie, "0", many))).status).toBe(413);
    const big = body(cookie, "0", [], { pad: "x".repeat(300_000) });
    expect((await post(cookie, big)).status).toBe(413);
  });

  it("is never cached, and refuses a cross-site form post", async () => {
    const { cookie } = await signIn("sync-headers");
    const res = await post(cookie, body(cookie, "0", []));
    expect(res.headers.get("cache-control")).toBe("no-store");
    const forged = await app.request("/api/sync", {
      method: "POST",
      headers: { cookie, origin: "https://evil.example", "content-type": "text/plain" },
      body: body(cookie, "0", [weight("2026-10-07", 20)]),
    });
    expect(forged.status).toBe(403);
  });
});

describe("the sync lock", () => {
  it("is a transaction-scoped advisory lock the application role may take", async () => {
    const { user } = await signIn("sync-lock");
    const held = await asUser(db, user, async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${user}, 0))`);
      const rows = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()`,
      );
      return rows[0]!.n;
    });
    expect(held).toBe(1);
  });
});
