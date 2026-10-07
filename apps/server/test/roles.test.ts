import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { describe, expect, it, inject } from "vitest";
import { asApp, asUser } from "../src/db/client";
import { upsertUser } from "../src/db/identity";
import * as schema from "../src/db/schema";
import { sessions, users } from "../src/db/schema";
import { appDb, testDb } from "./db";

const owner = testDb();
const { db } = appDb();
// drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its `cause`.
const permissionDenied = { cause: { code: "42501" } };

describe("the app connection", () => {
  it("logs in as belay_app", async () => {
    const [row] = await db.execute<{ session_user: string; current_user: string }>(
      sql`select session_user, current_user`,
    );
    expect(row).toEqual({ session_user: "belay_app", current_user: "belay_app" });
  });

  it("cannot create a table", async () => {
    await expect(db.execute(sql`create table intruder (id int)`)).rejects.toMatchObject(
      permissionDenied,
    );
  });

  it("cannot become the owner, and RESET ROLE leaves it belay_app", async () => {
    const [row] = await owner.db.execute<{ name: string }>(sql`select current_user as name`);
    await expect(db.execute(sql`set role ${sql.identifier(row!.name)}`)).rejects.toMatchObject(
      permissionDenied,
    );
    const after = await db.transaction(async (tx) => {
      await tx.execute(sql`reset role`);
      const [r] = await tx.execute<{ current_user: string }>(sql`select current_user`);
      return r!.current_user;
    });
    expect(after).toBe("belay_app");
  });

  it("cannot read sessions directly", async () => {
    await expect(db.select().from(sessions)).rejects.toMatchObject(permissionDenied);
  });
});

describe("app.user_id", () => {
  it("shows no row when it is empty", async () => {
    await upsertUser(db, { issuer: "https://idp.test", sub: "uid-empty", displayName: "E" });
    expect(await asUser(db, "", (tx) => tx.select().from(users))).toEqual([]);
  });

  it("refuses a value that is not a UUID, with no row", async () => {
    await upsertUser(db, { issuer: "https://idp.test", sub: "uid-garbage", displayName: "G" });
    for (const garbage of ["not-a-uuid", "' or true --", " "]) {
      // The value is a bound parameter, never SQL; the policy's cast refuses it (22P02).
      await expect(asUser(db, garbage, (tx) => tx.select().from(users))).rejects.toMatchObject({
        cause: { code: "22P02" },
      });
    }
  });
});

describe("a pooled connection", () => {
  it("never carries one transaction's user into the next", async () => {
    // One connection, so both transactions run on the same backend.
    const client = postgres(inject("appDatabaseUrl"), { max: 1, onnotice: () => {} });
    const single = drizzle(client, { schema });
    try {
      const user = await upsertUser(single, {
        issuer: "https://idp.test",
        sub: "pool-1",
        displayName: "P",
      });
      const pid = sql`select pg_backend_pid() as pid`;
      const [first] = await asUser(single, user, (tx) => tx.execute<{ pid: number }>(pid));
      await asUser(single, user, async () => {
        throw new Error("rolled back");
      }).catch(() => {});
      const next = await asApp(single, async (tx) => {
        const [row] = await tx.execute<{ pid: number; uid: string | null }>(
          sql`select pg_backend_pid() as pid, current_setting('app.user_id', true) as uid`,
        );
        return { ...row!, rows: await tx.select().from(users) };
      });
      expect(next.pid).toBe(first!.pid);
      expect(next.uid ?? "").toBe("");
      expect(next.rows).toEqual([]);
    } finally {
      await client.end();
    }
  });
});
