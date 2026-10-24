import { newId } from "@belay/shared";
import { sessionByCode, starterProgram } from "@belay/shared/training/program";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asUser, type Tx } from "../src/db/client";
import { upsertUser } from "../src/db/identity";
import { activities, dailySteps, users, workoutSets, workouts } from "../src/db/schema";
import { appDb, testDb } from "./db";

// As the server runs: the belay_app login role, row-level security on every query.
const { db } = appDb();
const owner = testDb().db;
const issuer = "https://idp.test";
// drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its `cause`.
const denied = { cause: { code: "42501" } };
const checkViolation = { cause: { code: "23514" } };
const AT = new Date("2026-10-07T17:00:00.000Z");
const climb = (userId: string, patch: Partial<typeof activities.$inferInsert> = {}) => ({
  id: newId(),
  userId,
  date: "2026-10-07",
  kind: "climbing",
  durationMin: 90,
  climbStyle: "boulder",
  climbRuns: 14,
  climbGrade: "6b+",
  fieldsAt: AT,
  ...patch,
});

// A and B, a day of steps and a climb of A's, and a session of A's with one set.
async function twoPeople(tag: string) {
  const a = await upsertUser(db, { issuer, sub: `${tag}-a`, displayName: "A" });
  const b = await upsertUser(db, { issuer, sub: `${tag}-b`, displayName: "B" });
  const activity = newId();
  const workout = newId();
  const set = newId();
  await asUser(db, a, async (tx) => {
    await tx.insert(dailySteps).values({ userId: a, date: "2026-10-07", steps: 8400, stepsAt: AT });
    await tx.insert(activities).values(climb(a, { id: activity }));
    await tx.insert(workouts).values({
      id: workout,
      userId: a,
      sessionCode: "C",
      plan: [...sessionByCode("C", starterProgram)!.slots],
      startedAt: AT,
    });
    await tx.insert(workoutSets).values({
      id: set,
      userId: a,
      workoutId: workout,
      slotIndex: 0,
      position: 3,
      exerciseId: "ds:2135",
      warmup: false,
      weightKg: 0,
      reps: null,
      seconds: 45,
      doneAt: AT,
      fieldsAt: AT,
    });
  });
  return { a, b, activity, workout, set };
}

const TABLES = { dailySteps, activities } as const;

describe("steps and activities as belay_app", () => {
  it("show each person their own rows only", async () => {
    const { a, b } = await twoPeople("ac-read");
    for (const [name, table] of Object.entries(TABLES)) {
      expect(await asUser(db, b, (tx) => tx.select().from(table)), name).toEqual([]);
      expect(await asUser(db, a, (tx) => tx.select().from(table)), name).toHaveLength(1);
    }
  });

  it("refuse a row written for someone else", async () => {
    const { a, b } = await twoPeople("ac-insert");
    const writes = [
      (tx: Tx) => tx.insert(dailySteps).values({ userId: a, date: "2026-10-08", steps: 1 }),
      (tx: Tx) => tx.insert(activities).values(climb(a)),
    ];
    for (const write of writes) await expect(asUser(db, b, write)).rejects.toMatchObject(denied);
  });

  it("update nothing of someone else's", async () => {
    const { a, b } = await twoPeople("ac-update");
    const updated = await asUser(db, b, async (tx) => [
      ...(await tx
        .update(dailySteps)
        .set({ steps: 1 })
        .where(eq(dailySteps.userId, a))
        .returning()),
      ...(await tx
        .update(activities)
        .set({ removed: true })
        .where(eq(activities.userId, a))
        .returning()),
    ]);
    expect(updated).toEqual([]);
  });

  it("can never delete, not even one's own rows", async () => {
    const { a } = await twoPeople("ac-delete");
    for (const [name, table] of Object.entries(TABLES))
      await expect(
        asUser(db, a, (tx) => tx.delete(table).where(eq(table.userId, a))),
        name,
      ).rejects.toMatchObject(denied);
  });

  it("keep every value inside its bounds, cardio and climbing fields apart", async () => {
    const { a, activity } = await twoPeople("ac-check");
    const one = eq(activities.id, activity);
    const refused = [
      (tx: Tx) => tx.update(dailySteps).set({ steps: 100_001 }).where(eq(dailySteps.userId, a)),
      (tx: Tx) => tx.update(dailySteps).set({ steps: -1 }).where(eq(dailySteps.userId, a)),
      (tx: Tx) => tx.update(activities).set({ kind: "yoga" }).where(one),
      (tx: Tx) => tx.update(activities).set({ durationMin: 4 }).where(one),
      (tx: Tx) => tx.update(activities).set({ durationMin: 485 }).where(one),
      (tx: Tx) => tx.update(activities).set({ durationMin: 92 }).where(one),
      (tx: Tx) => tx.update(activities).set({ climbRuns: 201 }).where(one),
      (tx: Tx) => tx.update(activities).set({ climbStyle: "ice" }).where(one),
      (tx: Tx) => tx.update(activities).set({ climbGrade: "9a" }).where(one),
      (tx: Tx) => tx.update(activities).set({ climbGrade: "6b++" }).where(one),
      (tx: Tx) => tx.update(activities).set({ climbColor: "orange" }).where(one),
      (tx: Tx) => tx.update(activities).set({ climbColor: "blue" }).where(one), // and a grade
      (tx: Tx) => tx.update(activities).set({ cardioType: "run" }).where(one), // on a climb
      (tx: Tx) => tx.update(activities).set({ kind: "cardio" }).where(one), // climbing fields
    ];
    for (const write of refused)
      await expect(asUser(db, a, write)).rejects.toMatchObject(checkViolation);
    // At the bounds: 5 and 480 minutes, 200 runs, 8c+, 100 000 steps, a colour alone, a cardio.
    await asUser(db, a, async (tx) => {
      await tx.update(activities).set({ durationMin: 480, climbRuns: 200 }).where(one);
      await tx.update(activities).set({ durationMin: 5, climbGrade: "8c+" }).where(one);
      await tx.update(activities).set({ climbGrade: null, climbColor: "white" }).where(one);
      await tx.update(dailySteps).set({ steps: 100_000 }).where(eq(dailySteps.userId, a));
      await tx.insert(activities).values({
        id: newId(),
        userId: a,
        date: "2026-10-07",
        kind: "cardio",
        durationMin: 45,
        cardioType: "bike",
        fieldsAt: AT,
      });
    });
  });

  it("disappear with their person", async () => {
    const { a } = await twoPeople("ac-cascade");
    await owner.delete(users).where(eq(users.id, a));
    for (const [name, table] of Object.entries(TABLES))
      expect(await owner.select().from(table).where(eq(table.userId, a)), name).toEqual([]);
  });
});

describe("a session's own plan and start, and a timed set, as belay_app", () => {
  it("count a set in reps or in seconds, never both and never neither", async () => {
    const { a, set } = await twoPeople("ac-measure");
    const one = eq(workoutSets.id, set);
    const refused = [
      (tx: Tx) => tx.update(workoutSets).set({ reps: 8 }).where(one), // and 45 seconds
      (tx: Tx) => tx.update(workoutSets).set({ seconds: null }).where(one), // neither
      (tx: Tx) => tx.update(workoutSets).set({ seconds: 3601 }).where(one),
      (tx: Tx) => tx.update(workoutSets).set({ seconds: -1 }).where(one),
    ];
    for (const write of refused)
      await expect(asUser(db, a, write)).rejects.toMatchObject(checkViolation);
    const [row] = await asUser(db, a, (tx) =>
      tx
        .update(workoutSets)
        .set({ reps: 10, seconds: null })
        .where(one)
        .returning({ reps: workoutSets.reps, seconds: workoutSets.seconds }),
    );
    expect(row).toEqual({ reps: 10, seconds: null });
  });

  it("keep a session's plan and start unwritten until changed, then with their time", async () => {
    const { a, workout } = await twoPeople("ac-plan");
    const read = () =>
      asUser(db, a, (tx) =>
        tx
          .select({ planAt: workouts.planAt, startedAtAt: workouts.startedAtAt })
          .from(workouts)
          .where(eq(workouts.id, workout)),
      );
    expect(await read()).toEqual([{ planAt: null, startedAtAt: null }]);
    await asUser(db, a, (tx) =>
      tx
        .update(workouts)
        .set({ planAt: AT, startedAtAt: AT, startedAt: new Date("2026-10-06T17:00:00.000Z") })
        .where(eq(workouts.id, workout)),
    );
    expect(await read()).toEqual([{ planAt: AT, startedAtAt: AT }]);
  });
});

describe("the database catalogue, after 0006", () => {
  it("has a policy on both new tables for belay_app, using and checking the person", async () => {
    const rows = await owner.execute<{ tablename: string; qual: string; with_check: string }>(
      sql`select tablename, qual, with_check from pg_policies
          where tablename in ('daily_steps', 'activities') order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(["activities", "daily_steps"]);
    for (const r of rows) {
      expect(r.qual).toContain("app.user_id");
      expect(r.with_check).toContain("app.user_id");
    }
  });
});
