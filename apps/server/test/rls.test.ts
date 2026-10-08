import { sql } from "drizzle-orm";
import { describe, expect, it, inject } from "vitest";
import { asApp, asUser, connect, runMigrations } from "../src/db/client";
import { createSession, deleteSession, sessionUser, upsertUser } from "../src/db/identity";
import { sessions, users } from "../src/db/schema";
import { testDb } from "./db";

const { db } = testDb();
const issuer = "https://idp.test";
// drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its `cause`.
const permissionDenied = {
  cause: { code: "42501", message: expect.stringMatching(/permission denied/) },
};

describe("row-level security", () => {
  it("lets a user read their own row and nobody else's", async () => {
    const a = await upsertUser(db, { issuer, sub: "rls-a", displayName: "A" });
    const b = await upsertUser(db, { issuer, sub: "rls-b", displayName: "B" });
    const seenByA = await asUser(db, a, (tx) => tx.select().from(users));
    expect(seenByA.map((u) => u.id)).toEqual([a]);
    expect(seenByA.map((u) => u.id)).not.toContain(b);
  });

  it("shows no user row when no user is set", async () => {
    await upsertUser(db, { issuer, sub: "rls-c", displayName: "C" });
    expect(await asApp(db, (tx) => tx.select().from(users))).toEqual([]);
  });

  it("forbids the application role from touching sessions directly", async () => {
    await expect(asApp(db, (tx) => tx.select().from(sessions))).rejects.toMatchObject(
      permissionDenied,
    );
  });

  it("forbids the application role from writing users directly", async () => {
    await expect(
      asApp(db, (tx) => tx.execute(sql`update users set display_name = 'x'`)),
    ).rejects.toMatchObject(permissionDenied);
  });
});

describe("identity functions", () => {
  it("upserts on (issuer, sub) and keeps the id stable", async () => {
    const first = await upsertUser(db, { issuer, sub: "same", displayName: "Old" });
    const second = await upsertUser(db, { issuer, sub: "same", displayName: "New" });
    expect(second).toBe(first);
    const [row] = await asUser(db, first, (tx) => tx.select().from(users));
    expect(row?.displayName).toBe("New");
  });

  it("resolves a live session and refuses an expired or deleted one", async () => {
    const user = await upsertUser(db, { issuer, sub: "sess", displayName: "S" });
    await createSession(db, "hash-live", user, 30);
    expect((await sessionUser(db, "hash-live", 30, 90))?.userId).toBe(user);

    await createSession(db, "hash-old", user, 30);
    await db.execute(
      sql`update sessions set expires_at = now() - interval '1 minute' where token_hash = 'hash-old'`,
    );
    expect(await sessionUser(db, "hash-old", 30, 90)).toBeNull();

    await deleteSession(db, "hash-live");
    expect(await sessionUser(db, "hash-live", 30, 90)).toBeNull();
  });

  it("slides the expiry back to the full lifetime on every lookup", async () => {
    const user = await upsertUser(db, { issuer, sub: "slide", displayName: "S" });
    await createSession(db, "hash-slide", user, 30);
    await db.execute(
      sql`update sessions set expires_at = now() + interval '1 hour' where token_hash = 'hash-slide'`,
    );
    expect(await sessionUser(db, "hash-slide", 30, 90)).toEqual({
      userId: user,
      maxAge: 30 * 86_400,
    });
    const [row] = await db.execute<{ full: boolean }>(
      sql`select (expires_at - now() > interval '29 days') as full from sessions where token_hash = 'hash-slide'`,
    );
    expect(row?.full).toBe(true);
  });

  it("ends a session at the absolute cap, however active", async () => {
    const user = await upsertUser(db, { issuer, sub: "cap", displayName: "C" });
    await createSession(db, "hash-cap", user, 30);
    // Signed in 89 days ago and used every day since: the deadline slides, but only to day 90.
    await db.execute(
      sql`update sessions set created_at = now() - interval '89 days' where token_hash = 'hash-cap'`,
    );
    const capped = await sessionUser(db, "hash-cap", 30, 90);
    expect(capped?.userId).toBe(user);
    expect(capped?.maxAge).toBeGreaterThan(86_400 - 60);
    expect(capped?.maxAge).toBeLessThanOrEqual(86_400);

    // Past day 90 it is refused, though its sliding deadline is still ahead.
    await db.execute(
      sql`update sessions set created_at = now() - interval '91 days', expires_at = now() + interval '20 days' where token_hash = 'hash-cap'`,
    );
    expect(await sessionUser(db, "hash-cap", 30, 90)).toBeNull();
  });
});

describe("security definer functions", () => {
  it("all pin search_path to public, pg_temp", async () => {
    const rows = await db.execute<{ proname: string; proconfig: string[] | null }>(sql`
      select p.proname, p.proconfig from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
      order by p.proname`);
    expect(rows.map((r) => r.proname)).toEqual(
      expect.arrayContaining(["belay_create_session", "belay_session_user"]),
    );
    for (const r of rows) expect(r.proconfig, r.proname).toEqual(["search_path=public, pg_temp"]);
  });

  it("ignore a temp table that shadows sessions", async () => {
    const victim = await upsertUser(db, { issuer, sub: "shadow-victim", displayName: "V" });
    const resolved = await asApp(db, async (tx) => {
      await tx.execute(
        sql`create temp table sessions (token_hash text, user_id uuid, expires_at timestamptz) on commit drop`,
      );
      await tx.execute(
        sql`insert into sessions values ('forged', ${victim}::uuid, now() + interval '1 day')`,
      );
      const rows = await tx.execute<{ user_id: string | null }>(
        sql`select user_id from belay_session_user('forged', interval '1 day', interval '90 days')`,
      );
      return rows[0]?.user_id ?? null;
    });
    expect(resolved).not.toBe(victim);
    expect(resolved).toBeNull();
  });
});

describe("migrations", () => {
  it("are idempotent", async () => {
    await expect(runMigrations(db, "drizzle")).resolves.toBeUndefined();
  });

  it("run into a second database of the same cluster, where belay_app already exists", async () => {
    await db.execute(sql`drop database if exists belay_second`);
    await db.execute(sql`create database belay_second`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = "/belay_second";
    const second = connect(url.href);
    try {
      await expect(runMigrations(second.db, "drizzle")).resolves.toBeUndefined();
      // The grants and policies are there too: the app role reads, and sees nobody.
      await upsertUser(second.db, { issuer, sub: "second", displayName: "Two" });
      expect(await asApp(second.db, (tx) => tx.select().from(users))).toEqual([]);
    } finally {
      await second.client.end();
    }
  });
});
