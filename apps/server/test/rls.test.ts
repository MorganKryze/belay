import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asApp, asUser, runMigrations } from "../src/db/client";
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
    expect(await sessionUser(db, "hash-live", 30)).toBe(user);

    await createSession(db, "hash-old", user, 30);
    await db.execute(
      sql`update sessions set expires_at = now() - interval '1 minute' where token_hash = 'hash-old'`,
    );
    expect(await sessionUser(db, "hash-old", 30)).toBeNull();

    await deleteSession(db, "hash-live");
    expect(await sessionUser(db, "hash-live", 30)).toBeNull();
  });
});

describe("migrations", () => {
  it("are idempotent", async () => {
    await expect(runMigrations(db, "drizzle")).resolves.toBeUndefined();
  });
});
