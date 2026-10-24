import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@belay/shared";
import type { Change, SyncResponse } from "@belay/shared/sync/schema";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { seedId } from "@belay/shared/training/stored-program";
import { eq, sql } from "drizzle-orm";
import { describe, expect, inject, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { connect, runMigrations } from "../src/db/client";
import { createSession, upsertUser } from "../src/db/identity";
import { workouts } from "../src/db/schema";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

// A session done keeps its session's name of the day: written once with the start, sent back as
// it was kept, never rewritten. The server as it runs (belay_app, row-level security); the owner
// only arranges and reads rows.
const { db } = appDb();
const owner = testDb().db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });
const issuer = "https://idp.test";
const checkViolation = { cause: { code: "23514" } };

const AT = "2026-10-07T17:00:00.000Z";
const LATER = "2026-10-07T17:05:00.000Z";
const PLAN = [...sessionByCode("B", starterProgram)!.slots];
const SESSION_B = seedId(2);

async function signIn(sub: string) {
  const user = await upsertUser(db, { issuer, sub, displayName: sub });
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  const cookie = `${SESSION_COOKIE}=${token}`;
  const sync = async (cursor: string, changes: Change[] = []) => {
    const res = await app.request("/api/sync", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ account: user, cursor, changes }),
    });
    return { status: res.status, body: (await res.json()) as SyncResponse };
  };
  return { user, sync };
}

const start = (id: string, sessionName?: string | null): Change => ({
  kind: "workout",
  id,
  field: "start",
  sessionCode: "B",
  sessionId: SESSION_B,
  ...(sessionName !== undefined && { sessionName }),
  plan: PLAN,
  startedAt: AT,
  at: AT,
});
const stored = async (id: string) =>
  (
    await owner
      .select({ name: workouts.sessionName, kept: workouts.sessionNameKept })
      .from(workouts)
      .where(eq(workouts.id, id))
  )[0];

describe("a session's name of the day through /api/sync", () => {
  it("keeps the name, a null name, or nothing, and sends each back as it was kept (HN1, HN3)", async () => {
    const { sync } = await signIn("hn-kept");
    const [named, unnamed, older] = [newId(), newId(), newId()];
    const { status, body } = await sync("0", [
      start(named, "Legs"),
      start(unnamed, null),
      start(older),
    ]);
    expect(status).toBe(200);
    expect(body.rejected).toEqual([]);
    const rows = new Map(body.workouts.map((w) => [w.id, w]));
    expect(rows.get(named)!.sessionName).toBe("Legs");
    expect(rows.get(unnamed)!.sessionName).toBeNull();
    expect(rows.get(older)).not.toHaveProperty("sessionName");
    expect(await stored(named)).toEqual({ name: "Legs", kept: true });
    expect(await stored(unnamed)).toEqual({ name: null, kept: true });
    expect(await stored(older)).toEqual({ name: null, kept: false });
  });

  it("never rewrites it: a second start, an edit of the day, the plan or the end leave it (HN4)", async () => {
    const { sync } = await signIn("hn-once");
    const id = newId();
    const first = await sync("0", [start(id, "Legs")]);
    const later: Change[] = [
      start(id, "Bas du corps"),
      { kind: "workout", id, field: "plan", value: PLAN.slice(1), at: LATER },
      { kind: "workout", id, field: "startedAt", value: AT, at: LATER },
      { kind: "workout", id, field: "ended", value: LATER, at: LATER },
      { kind: "workout", id, field: "note", value: "Lourd", at: LATER },
    ];
    const second = await sync(first.body.cursor, later);
    expect(second.status).toBe(200);
    expect(await stored(id)).toEqual({ name: "Legs", kept: true });
    const { body } = await sync("0");
    expect(body.workouts.find((w) => w.id === id)!.sessionName).toBe("Legs");
  });

  it("refuses the whole request when a name breaks the session-name rule (HN2)", async () => {
    const { user, sync } = await signIn("hn-bounds");
    for (const bad of ["x".repeat(41), "", " Legs", "Le\u0000gs"]) {
      const id = newId();
      expect((await sync("0", [start(id, bad)])).status).toBe(400);
      expect(await stored(id)).toBeUndefined();
    }
    expect(await owner.select().from(workouts).where(eq(workouts.userId, user))).toEqual([]);
  });

  it("sends a session's name only to its own account (HN8)", async () => {
    const a = await signIn("hn-iso-a");
    const b = await signIn("hn-iso-b");
    const id = newId();
    await a.sync("0", [start(id, "Legs")]);
    const { body } = await b.sync("0");
    expect(body.workouts.map((w) => w.id)).not.toContain(id);
  });

  it("the database holds a name only when kept, 1 to 40 characters (HN2)", async () => {
    const { user } = await signIn("hn-check");
    const row = (patch: Partial<typeof workouts.$inferInsert>) =>
      owner.insert(workouts).values({
        id: newId(),
        userId: user,
        sessionCode: "B",
        plan: PLAN,
        startedAt: new Date(AT),
        ...patch,
      });
    await expect(row({ sessionName: "Legs", sessionNameKept: false })).rejects.toMatchObject(
      checkViolation,
    );
    await expect(row({ sessionName: "x".repeat(41), sessionNameKept: true })).rejects.toMatchObject(
      checkViolation,
    );
    await expect(row({ sessionName: "", sessionNameKept: true })).rejects.toMatchObject(
      checkViolation,
    );
    await row({ sessionName: "x".repeat(40), sessionNameKept: true });
    await row({ sessionName: null, sessionNameKept: true });
  });
});

// Every row of each table as text in a stable order, with its columns; the columns the migration
// adds are left out of both, so the tables compare equal around it.
const ADDED = "'session_name', 'session_name_kept'";
async function dump(conn: ReturnType<typeof connect>["db"], tables: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const table of tables) {
    const [rows] = await conn.execute<{ rows: string }>(
      sql`select coalesce(json_agg(r order by r), '[]')::text as rows
          from (select (to_jsonb(t) - array[${sql.raw(ADDED)}])::text as r from ${sql.identifier(table)} t) s`,
    );
    const columns = await conn.execute(
      sql`select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = ${table}
            and column_name not in (${sql.raw(ADDED)})
          order by ordinal_position`,
    );
    out[table] = { rows: rows!.rows, columns: [...columns] };
  }
  return out;
}

describe("migration 0008", () => {
  it("on a database populated at 0007 keeps every row; sessions done keep no name (HN6)", async () => {
    // The migrations up to 0007 only, from a copy of the folder whose journal stops there.
    const upTo0007 = mkdtempSync(join(tmpdir(), "belay-0007-"));
    cpSync("drizzle", upTo0007, { recursive: true });
    const journalPath = join(upTo0007, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx <= 7);
    writeFileSync(journalPath, JSON.stringify(journal));

    await owner.execute(sql`drop database if exists belay_0008`);
    await owner.execute(sql`create database belay_0008`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = "/belay_0008";
    const fresh = connect(url.href);
    try {
      await runMigrations(fresh.db, upTo0007);
      const user = newId();
      await fresh.db.execute(sql`insert into users (id, oidc_issuer, oidc_sub, display_name)
        values (${user}, ${issuer}, 'populated', 'P')`);
      await fresh.db
        .execute(sql`insert into workouts (id, user_id, session_code, session_id, plan, started_at, ended_at)
        values (${newId()}, ${user}, 'B', ${SESSION_B}, '[{"exerciseId": "ds:0025"}]'::jsonb, ${AT}, ${AT}),
               (${newId()}, ${user}, 'A', null, '[{"exerciseId": "ds:0043"}]'::jsonb, ${AT}, null)`);
      const tables = (
        await fresh.db.execute<{ tablename: string }>(
          sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
        )
      ).map((r) => r.tablename);
      const before = await dump(fresh.db, tables);

      await runMigrations(fresh.db, "drizzle");

      expect(await dump(fresh.db, tables)).toEqual(before);
      const kept = await fresh.db.execute(
        sql`select session_name, session_name_kept from workouts order by session_code`,
      );
      expect([...kept]).toEqual([
        { session_name: null, session_name_kept: false },
        { session_name: null, session_name_kept: false },
      ]);
      const policies = await fresh.db.execute(
        sql`select policyname from pg_policies where tablename = 'workouts' order by policyname`,
      );
      expect([...policies]).toEqual([{ policyname: "workouts_owner" }]);
    } finally {
      await fresh.client.end();
      await owner.execute(sql`drop database if exists belay_0008`);
    }
  });
});
