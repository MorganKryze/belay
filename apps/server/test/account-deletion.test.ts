import { newId } from "@belay/shared";
import type { Change } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { seedId } from "@belay/shared/training/stored-program";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { asApp, asUser } from "../src/db/client";
import { createSession, deleteAccount, upsertUser } from "../src/db/identity";
import { testEnv } from "./config";
import { agree, appDb, testDb } from "./db";
import { startIdp } from "./idp";

const { db } = appDb();
const ownerConn = testDb();
const owner = ownerConn.db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });
const issuer = "https://idp.test";
const AT = "2026-11-20T07:00:00.000Z";
const PLAN = [...sessionByCode("B", starterProgram)!.slots];
const permissionDenied = { cause: { code: "42501" } };

async function device(user: string) {
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  return {
    token,
    call: (path: string, body?: unknown) =>
      app.request(path, {
        method: body === undefined ? "GET" : "POST",
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      }),
  };
}

// One change of every synced kind, so every table with a user_id holds a row of this account.
function everyKind(): Change[] {
  const supplement = newId();
  const workout = newId();
  return [
    { kind: "weight", date: "2026-11-20", weightKg: 80, at: AT },
    { kind: "measure", date: "2026-11-20", field: "waist", value: 85, at: AT },
    { kind: "intake", date: "2026-11-20", field: "kcal", value: 2200, at: AT },
    { kind: "profile", field: "height", value: 180, at: AT },
    { kind: "target", minPct: 0.5, maxPct: 1, at: AT },
    { kind: "supplement", id: supplement, field: "name", value: "Créatine", at: AT },
    { kind: "supplementLog", supplementId: supplement, date: "2026-11-20", taken: true, at: AT },
    {
      kind: "annotation",
      id: newId(),
      field: "fields",
      date: "2026-11-20",
      type: "note",
      label: "x",
      at: AT,
    },
    { kind: "steps", date: "2026-11-20", value: 9000, at: AT },
    {
      kind: "activity",
      id: newId(),
      field: "fields",
      date: "2026-11-20",
      type: "climbing",
      durationMin: 90,
      cardioType: null,
      climbStyle: "boulder",
      climbRuns: 14,
      climbGrade: "6b+",
      climbColor: null,
      at: AT,
    },
    {
      kind: "workout",
      id: workout,
      field: "start",
      sessionCode: "B",
      sessionId: seedId(2),
      plan: PLAN,
      startedAt: AT,
      at: AT,
    },
    {
      kind: "set",
      id: newId(),
      workoutId: workout,
      field: "create",
      slotIndex: 0,
      position: 0,
      exerciseId: PLAN[0]!.exerciseId,
      warmup: false,
      weightKg: 60,
      reps: 8,
      seconds: null,
      rir: 2,
      doneAt: AT,
      at: AT,
    },
  ];
}

async function account(sub: string) {
  const user = await upsertUser(db, { issuer, sub, displayName: sub });
  await agree(db, user);
  const phone = await device(user);
  const res = await phone.call("/api/sync", { account: user, cursor: "0", changes: everyKind() });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { rejected: unknown[] }).rejected).toEqual([]);
  return { user, phone };
}

// Read from the catalogue: a table added later with a user_id is counted without editing this.
const userTables = async () =>
  (
    await owner.execute<{ table_name: string }>(
      sql`select table_name from information_schema.columns
          where table_schema = 'public' and column_name = 'user_id' order by table_name`,
    )
  ).map((r) => r.table_name);

// Every row of the account in each table, whole, as text in a stable order.
const dumpOf = async (user: string) => {
  const out: Record<string, string> = {};
  for (const table of [...(await userTables()), "users"]) {
    const column = table === "users" ? "id" : "user_id";
    const [row] = await owner.execute<{ rows: string }>(
      sql`select coalesce(json_agg(r order by r), '[]')::text as rows
          from (select to_jsonb(t)::text as r from ${sql.identifier(table)} t
                where ${sql.identifier(column)} = ${user}) s`,
    );
    out[table] = row!.rows;
  }
  return out;
};

const countsOf = async (user: string) => {
  const out: Record<string, number> = {};
  for (const table of await userTables()) {
    const [row] = await owner.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${user}`,
    );
    out[table] = row!.n;
  }
  return out;
};

describe("deleting an account", () => {
  it("erases every row of every table with a user_id, and leaves another account's alone", async () => {
    const gone = await account("delete-gone");
    const kept = await account("delete-kept");
    const before = await countsOf(gone.user);
    const keptBefore = await countsOf(kept.user);
    const keptRows = await dumpOf(kept.user);
    // Every table is seeded for both, so the proof below is never about an empty table.
    for (const [table, n] of Object.entries(before)) expect(n, table).toBeGreaterThan(0);
    for (const [table, n] of Object.entries(keptBefore)) expect(n, table).toBeGreaterThan(0);

    expect((await gone.phone.call("/api/me/delete", {})).status).toBe(204);

    for (const [table, n] of Object.entries(await countsOf(gone.user))) expect(n, table).toBe(0);
    expect(await dumpOf(kept.user)).toEqual(keptRows);
    // As the app role, under the deleted account's own id, too.
    for (const table of await userTables()) {
      if (table === "sessions") continue; // no grant: reached only through the functions
      const [row] = await asUser(db, gone.user, (tx) =>
        tx.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)}`),
      );
      expect(row!.n, table).toBe(0);
    }
    const [user] = await owner.execute<{ n: number }>(
      sql`select count(*)::int as n from users where id = ${gone.user}`,
    );
    expect(user!.n).toBe(0);
  });

  it("deletes nothing for a token that opens no live session", async () => {
    const other = await account("delete-other");
    const before = await countsOf(other.user);
    expect(await deleteAccount(db, hashToken(newSessionToken(), cfg.tokenHashKey))).toBeNull();
    await owner.execute(
      sql`update sessions set expires_at = now() - interval '1 second' where user_id = ${other.user}`,
    );
    expect(await deleteAccount(db, hashToken(other.phone.token, cfg.tokenHashKey))).toBeNull();
    // Any sign-in, in any test file, purges expired sessions: they are left out of the count.
    expect({ ...(await countsOf(other.user)), sessions: 0 }).toEqual({ ...before, sessions: 0 });
  });

  it("leaves the app role with no DELETE on any table", async () => {
    const someone = await account("delete-grant");
    for (const table of await userTables()) {
      if (table === "sessions") continue;
      await expect(
        asUser(db, someone.user, (tx) => tx.execute(sql`delete from ${sql.identifier(table)}`)),
      ).rejects.toMatchObject(permissionDenied);
    }
    await expect(
      asApp(db, (tx) => tx.execute(sql`delete from ended_sessions`)),
    ).rejects.toMatchObject(permissionDenied);
    const grants = await owner.execute(
      sql`select table_name from information_schema.role_table_grants
          where grantee = 'belay_app' and privilege_type = 'DELETE'`,
    );
    expect([...grants]).toEqual([]);
  });

  it("keeps the erasure by account id out of the app role's reach", async () => {
    const other = await account("delete-erase-direct");
    await expect(
      asApp(db, (tx) => tx.execute(sql`select belay_erase_account(${other.user}::uuid)`)),
    ).rejects.toMatchObject(permissionDenied);
    const [row] = await owner.execute<{ app: boolean; anyone: boolean }>(
      sql`select has_function_privilege('belay_app', 'belay_erase_account(uuid)', 'EXECUTE') as app,
                 has_function_privilege('public', 'belay_erase_account(uuid)', 'EXECUTE') as anyone`,
    );
    expect(row).toEqual({ app: false, anyone: false });
  });

  it("cascades every reference to an account, and every other table names its account", async () => {
    const actions = await owner.execute<{ table: string; action: string }>(
      sql`select conrelid::regclass::text as table, confdeltype::text as action from pg_constraint
          where contype = 'f' and confrelid = 'public.users'::regclass order by 1`,
    );
    expect(actions.length).toBeGreaterThan(0);
    for (const { table, action } of actions) expect(action, table).toBe("c");
    const tables = await owner.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
            and table_name not in ('users', 'ended_sessions') order by 1`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(await userTables());
  });

  it("clears the session cookie of the browser that deleted the account", async () => {
    const user = await upsertUser(db, { issuer, sub: "delete-cookie", displayName: "K" });
    const token = newSessionToken();
    await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
    const res = await app.request("/api/me/delete", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=${token}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(204);
    const cleared = res.headers.getSetCookie().filter((c) => c.startsWith(`${SESSION_COOKIE}=`));
    // The last one the browser reads wins: the lookup's sliding cookie comes first.
    expect(cleared.at(-1)).toMatch(/Max-Age=0/i);
  });

  it("tells the account's other devices 410 account_deleted, from a table that names no one", async () => {
    const { user, phone } = await account("delete-410");
    const tablet = await device(user);
    expect((await phone.call("/api/me/delete", {})).status).toBe(204);
    for (const path of ["/api/me", "/api/sync"]) {
      const res = await tablet.call(
        path,
        path === "/api/sync" ? { account: user, cursor: "0", changes: [] } : undefined,
      );
      expect(res.status, path).toBe(410);
      expect(await res.json()).toEqual({ error: "account_deleted" });
    }
    const columns = await owner.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns
          where table_name = 'ended_sessions' order by column_name`,
    );
    expect(columns.map((c) => c.column_name)).toEqual(["expires_at", "token_hash"]);
    // A token never seen is still a plain 401.
    const stranger = await app.request("/api/me", {
      headers: { authorization: `Bearer ${newSessionToken()}` },
    });
    expect(stranger.status).toBe(401);
  });

  it("purges an ended token once it would have expired", async () => {
    const { user, phone } = await account("delete-purge");
    const tablet = await device(user);
    expect((await phone.call("/api/me/delete", {})).status).toBe(204);
    await owner.execute(sql`update ended_sessions set expires_at = now() - interval '1 second'`);
    expect((await tablet.call("/api/me")).status).toBe(401);
    // The next deletion or sign-in purges it.
    const next = await upsertUser(db, { issuer, sub: "delete-purge-next", displayName: "N" });
    await device(next);
    const [row] = await owner.execute<{ n: number }>(
      sql`select count(*)::int as n from ended_sessions where expires_at <= now()`,
    );
    expect(row!.n).toBe(0);
  });

  it("opens no session for an account deleted after its sign-in code was issued", async () => {
    const user = await upsertUser(db, { issuer, sub: "delete-code", displayName: "C" });
    const phone = await device(user);
    expect((await phone.call("/api/me/delete", {})).status).toBe(204);
    expect(await createSession(db, hashToken(newSessionToken(), cfg.tokenHashKey), user, 30)).toBe(
      false,
    );
  });
});

// The app's sign-in as native-auth.test.ts drives it: start, the provider, the callback's code.
describe("a sign-in code issued before the account was deleted", () => {
  const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  let idp: Awaited<ReturnType<typeof startIdp>>;
  let native: Hono;
  let nextClaims: Record<string, unknown> = {};

  beforeAll(async () => {
    idp = await startIdp();
    idp.service.on("beforeTokenSigning", (token) => {
      Object.assign(token.payload, nextClaims);
    });
    const ncfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url! }));
    native = createApp({ cfg: ncfg, db, getOidc: oidcProvider(ncfg.oidc) });
  });
  afterAll(() => idp.stop());

  async function signIn(
    claims: Record<string, unknown>,
    from = `/auth/native/start?challenge=${CHALLENGE}`,
  ) {
    const res = await native.request(from);
    expect(res.status).toBe(302);
    const authUrl = new URL(res.headers.get("location")!);
    const txCookie = res.headers.get("set-cookie")!.split(";")[0]!;
    nextClaims = {
      auth_time: Math.floor(Date.now() / 1000),
      ...claims,
      nonce: authUrl.searchParams.get("nonce"),
    };
    const idpRes = await fetch(authUrl, { redirect: "manual" });
    const cb = new URL(idpRes.headers.get("location")!);
    return native.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
  }

  it("is refused as invalid_grant once the account is gone", async () => {
    const sub = `delete-native-${Math.random().toString(36).slice(2)}`;
    const res = await signIn({ sub });
    const code = new URL(res.headers.get("location")!).searchParams.get("code")!;
    expect(code).toBeTruthy();
    const [row] = await owner.execute<{ id: string }>(
      sql`select id from users where oidc_sub = ${sub}`,
    );
    const phone = await device(row!.id);
    expect((await phone.call("/api/me/delete", {})).status).toBe(204);
    const redeemed = await native.request("/auth/native/token", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://localhost" },
      body: JSON.stringify({ code, verifier: VERIFIER }),
    });
    expect(redeemed.status).toBe(400);
    expect(await redeemed.json()).toEqual({ error: "invalid_grant" });
  });
});
