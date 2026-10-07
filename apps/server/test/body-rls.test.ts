import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asUser } from "../src/db/client";
import { upsertUser } from "../src/db/identity";
import { bodyMetrics, users } from "../src/db/schema";
import { testDb } from "./db";

const { db } = testDb();
const issuer = "https://idp.test";
// drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its `cause`.
const denied = { cause: { code: "42501" } }; // permission denied, or a row-level security violation
const checkViolation = { cause: { code: "23514" } };
const AT = "2026-10-07T06:30:00.000Z";

async function twoPeople(tag: string) {
  const a = await upsertUser(db, { issuer, sub: `${tag}-a`, displayName: "A" });
  const b = await upsertUser(db, { issuer, sub: `${tag}-b`, displayName: "B" });
  await asUser(db, a, (tx) =>
    tx
      .insert(bodyMetrics)
      .values({ userId: a, date: "2026-10-07", weightKg: 80.4, weightAt: new Date(AT) }),
  );
  return { a, b };
}

describe("body_metrics as belay_app", () => {
  it("shows each person their own days only", async () => {
    const { a, b } = await twoPeople("bm-read");
    const seenByB = await asUser(db, b, (tx) => tx.select().from(bodyMetrics));
    expect(seenByB).toEqual([]);
    const seenByA = await asUser(db, a, (tx) => tx.select().from(bodyMetrics));
    expect(seenByA.map((r) => [r.date, r.weightKg])).toEqual([["2026-10-07", 80.4]]);
  });

  it("refuses a row written for someone else", async () => {
    const { a, b } = await twoPeople("bm-insert");
    await expect(
      asUser(db, b, (tx) =>
        tx.insert(bodyMetrics).values({ userId: a, date: "2026-10-06", weightKg: 70 }),
      ),
    ).rejects.toMatchObject(denied);
  });

  it("updates nothing of someone else's, even through an upsert", async () => {
    const { a, b } = await twoPeople("bm-update");
    const updated = await asUser(db, b, (tx) =>
      tx.update(bodyMetrics).set({ weightKg: 50 }).where(eq(bodyMetrics.userId, a)).returning(),
    );
    expect(updated).toEqual([]);
    await expect(
      asUser(db, b, (tx) =>
        tx
          .insert(bodyMetrics)
          .values({ userId: a, date: "2026-10-07", weightKg: 50 })
          .onConflictDoUpdate({
            target: [bodyMetrics.userId, bodyMetrics.date],
            set: { weightKg: 50 },
          }),
      ),
    ).rejects.toMatchObject(denied);
    const [row] = await asUser(db, a, (tx) => tx.select().from(bodyMetrics));
    expect(row?.weightKg).toBe(80.4);
  });

  it("can never delete, not even one's own day", async () => {
    const { a } = await twoPeople("bm-delete");
    await expect(
      asUser(db, a, (tx) => tx.delete(bodyMetrics).where(eq(bodyMetrics.userId, a))),
    ).rejects.toMatchObject(denied);
  });

  it("keeps weights between 20 and 400 kg", async () => {
    const { a } = await twoPeople("bm-check");
    await expect(
      asUser(db, a, (tx) =>
        tx.insert(bodyMetrics).values({ userId: a, date: "2026-10-01", weightKg: 401 }),
      ),
    ).rejects.toMatchObject(checkViolation);
  });

  it("disappears with its person", async () => {
    const { a } = await twoPeople("bm-cascade");
    await db.delete(users).where(eq(users.id, a));
    const left = await db.select().from(bodyMetrics).where(eq(bodyMetrics.userId, a));
    expect(left).toEqual([]);
  });
});

describe("the target range on users as belay_app", () => {
  it("lets a person write their own range, and only the range", async () => {
    const { a } = await twoPeople("tr-own");
    const [row] = await asUser(db, a, (tx) =>
      tx
        .update(users)
        .set({ targetMinPct: 0.25, targetMaxPct: 0.75, targetAt: new Date(AT) })
        .where(eq(users.id, a))
        .returning({ min: users.targetMinPct, max: users.targetMaxPct }),
    );
    expect(row).toEqual({ min: 0.25, max: 0.75 });
    await expect(
      asUser(db, a, (tx) => tx.update(users).set({ displayName: "x" }).where(eq(users.id, a))),
    ).rejects.toMatchObject(denied);
  });

  it("starts at 0.5 to 1 % and refuses a range the app does not offer", async () => {
    const { a } = await twoPeople("tr-check");
    const [row] = await asUser(db, a, (tx) =>
      tx
        .select({ min: users.targetMinPct, max: users.targetMaxPct, at: users.targetAt })
        .from(users),
    );
    expect(row).toEqual({ min: 0.5, max: 1, at: null });
    await expect(
      asUser(db, a, (tx) =>
        tx.update(users).set({ targetMinPct: 0.95, targetMaxPct: 1 }).where(eq(users.id, a)),
      ),
    ).rejects.toMatchObject(checkViolation);
  });

  it("never reads or writes someone else's range", async () => {
    const { a, b } = await twoPeople("tr-other");
    const updated = await asUser(db, b, (tx) =>
      tx.update(users).set({ targetMinPct: 0.25 }).where(eq(users.id, a)).returning(),
    );
    expect(updated).toEqual([]);
    const seen = await asUser(db, b, (tx) =>
      tx.select({ id: users.id }).from(users).where(eq(users.id, a)),
    );
    expect(seen).toEqual([]);
  });
});

describe("the database catalogue", () => {
  it("has row-level security on every table in public", async () => {
    const rows = await db.execute<{ relname: string }>(
      sql`select relname from pg_class
          where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity`,
    );
    expect(rows.map((r) => r.relname)).toEqual([]);
  });
});
