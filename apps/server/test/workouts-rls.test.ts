import { newId } from "@belay/shared";
import { sessionByCode } from "@belay/shared/training/program";
import { planBytes } from "@belay/shared/training/workout";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asUser, type Tx } from "../src/db/client";
import { upsertUser } from "../src/db/identity";
import { users, workoutSets, workouts } from "../src/db/schema";
import { appDb, testDb } from "./db";

// As the server runs: the belay_app login role, row-level security on every query.
const { db } = appDb();
const owner = testDb().db;
const issuer = "https://idp.test";
// drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its `cause`.
const denied = { cause: { code: "42501" } };
const checkViolation = { cause: { code: "23514" } };
const foreignKey = { cause: { code: "23503" } };
const AT = new Date("2026-10-07T17:00:00.000Z");
const PLAN = [...sessionByCode("A")!.slots];

const setOf = (
  userId: string,
  workoutId: string,
  patch: Partial<typeof workoutSets.$inferInsert> = {},
) => ({
  id: newId(),
  userId,
  workoutId,
  slotIndex: 0,
  position: 3,
  exerciseId: "ds:0025",
  warmup: false,
  weightKg: 82.5,
  reps: 8,
  rir: 1,
  doneAt: AT,
  fieldsAt: AT,
  ...patch,
});

// A and B, and a session of A's with one set.
async function twoPeople(tag: string) {
  const a = await upsertUser(db, { issuer, sub: `${tag}-a`, displayName: "A" });
  const b = await upsertUser(db, { issuer, sub: `${tag}-b`, displayName: "B" });
  const workout = newId();
  const set = newId();
  await asUser(db, a, async (tx) => {
    await tx
      .insert(workouts)
      .values({ id: workout, userId: a, sessionCode: "A", plan: PLAN, startedAt: AT });
    await tx.insert(workoutSets).values(setOf(a, workout, { id: set }));
  });
  return { a, b, workout, set };
}

const TABLES = { workouts, workoutSets } as const;

describe("sessions and sets as belay_app", () => {
  it("show each person their own rows only", async () => {
    const { a, b } = await twoPeople("wk-read");
    for (const [name, table] of Object.entries(TABLES)) {
      expect(await asUser(db, b, (tx) => tx.select().from(table)), name).toEqual([]);
      expect(await asUser(db, a, (tx) => tx.select().from(table)), name).toHaveLength(1);
    }
  });

  it("refuse a row written for someone else", async () => {
    const { a, b, workout } = await twoPeople("wk-insert");
    const writes = [
      (tx: Tx) =>
        tx
          .insert(workouts)
          .values({ id: newId(), userId: a, sessionCode: "B", plan: PLAN, startedAt: AT }),
      (tx: Tx) => tx.insert(workoutSets).values(setOf(a, workout)),
    ];
    for (const write of writes) await expect(asUser(db, b, write)).rejects.toMatchObject(denied);
  });

  it("update nothing of someone else's", async () => {
    const { a, b } = await twoPeople("wk-update");
    const updated = await asUser(db, b, async (tx) => [
      ...(await tx.update(workouts).set({ note: "x" }).where(eq(workouts.userId, a)).returning()),
      ...(await tx
        .update(workoutSets)
        .set({ reps: 1 })
        .where(eq(workoutSets.userId, a))
        .returning()),
    ]);
    expect(updated).toEqual([]);
  });

  it("never add a set to someone else's session, even under one's own name", async () => {
    const { b, workout } = await twoPeople("wk-foreign");
    await expect(
      asUser(db, b, (tx) => tx.insert(workoutSets).values(setOf(b, workout))), // A's session
    ).rejects.toMatchObject(foreignKey);
  });

  it("can never delete, not even one's own rows", async () => {
    const { a } = await twoPeople("wk-delete");
    for (const [name, table] of Object.entries(TABLES))
      await expect(
        asUser(db, a, (tx) => tx.delete(table).where(eq(table.userId, a))),
        name,
      ).rejects.toMatchObject(denied);
  });

  it("keep every value inside its bounds", async () => {
    const { a, workout, set } = await twoPeople("wk-check");
    const one = eq(workoutSets.id, set);
    const refused = [
      (tx: Tx) => tx.update(workouts).set({ sessionCode: "AB" }).where(eq(workouts.id, workout)),
      (tx: Tx) => tx.update(workouts).set({ sessionCode: "a" }).where(eq(workouts.id, workout)),
      (tx: Tx) =>
        tx
          .update(workouts)
          .set({ note: "x".repeat(501) })
          .where(eq(workouts.id, workout)),
      (tx: Tx) =>
        tx
          .update(workouts)
          .set({ plan: Array.from({ length: 200 }, () => PLAN[0]!) }) // about 33 KB as text
          .where(eq(workouts.id, workout)),
      (tx: Tx) => tx.update(workoutSets).set({ slotIndex: 30 }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ position: 50 }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ exerciseId: "bench" }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ exerciseId: "DS:0025" }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ weightKg: 500.25 }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ weightKg: -0.25 }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ reps: 101 }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ rir: 5 }).where(one),
    ];
    for (const write of refused)
      await expect(asUser(db, a, write)).rejects.toMatchObject(checkViolation);
    // At the bounds: 500 kg, 100 reps, RIR 4, a note of 500 characters.
    await asUser(db, a, async (tx) => {
      await tx.update(workoutSets).set({ weightKg: 500, reps: 100, rir: 4 }).where(one);
      await tx
        .update(workouts)
        .set({ note: "é".repeat(500) })
        .where(eq(workouts.id, workout));
    });
  });

  it("read loads back as numbers, and the plan as it was written", async () => {
    const { a } = await twoPeople("wk-numeric");
    const [set] = await asUser(db, a, (tx) =>
      tx.select({ kg: workoutSets.weightKg }).from(workoutSets),
    );
    expect(set).toEqual({ kg: 82.5 });
    const [w] = await asUser(db, a, (tx) => tx.select({ plan: workouts.plan }).from(workouts));
    expect(w?.plan).toEqual(PLAN);
  });

  it("measure the plan as the shared rule does", async () => {
    const { a, workout } = await twoPeople("wk-bytes");
    const [row] = await asUser(db, a, (tx) =>
      tx.execute<{ bytes: number }>(
        sql`select octet_length(plan::text) as bytes from workouts where id = ${workout}`,
      ),
    );
    expect(row?.bytes).toBe(planBytes(PLAN));
  });

  it("disappear with their person", async () => {
    const { a } = await twoPeople("wk-cascade");
    await owner.delete(users).where(eq(users.id, a));
    for (const [name, table] of Object.entries(TABLES))
      expect(await owner.select().from(table).where(eq(table.userId, a)), name).toEqual([]);
  });
});

describe("the database catalogue, after 0005", () => {
  it("has a policy on both tables for belay_app, using and checking the person", async () => {
    const rows = await owner.execute<{ tablename: string; qual: string; with_check: string }>(
      sql`select tablename, qual, with_check from pg_policies
          where tablename in ('workouts', 'workout_sets') order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(["workout_sets", "workouts"]);
    for (const r of rows) {
      expect(r.qual).toContain("app.user_id");
      expect(r.with_check).toContain("app.user_id");
    }
  });
});
