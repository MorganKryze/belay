import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sessions } from "../src/db/schema";
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
