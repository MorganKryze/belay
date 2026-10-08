import { newId } from "@belay/shared";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asUser, type Tx } from "../src/db/client";
import { upsertUser } from "../src/db/identity";
import {
  annotations,
  bodyMetrics,
  intakeLogs,
  supplementLogs,
  supplements,
  users,
} from "../src/db/schema";
import { appDb, testDb } from "./db";

// As the server runs: the belay_app login role, row-level security on every query.
const { db } = appDb();
const owner = testDb().db;
const issuer = "https://idp.test";
// drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its `cause`.
const denied = { cause: { code: "42501" } }; // permission denied, or a row-level security violation
const checkViolation = { cause: { code: "23514" } };
const foreignKey = { cause: { code: "23503" } };
const AT = new Date("2026-10-07T06:30:00.000Z");

// A and B, and one row of A's in every new table.
async function twoPeople(tag: string) {
  const a = await upsertUser(db, { issuer, sub: `${tag}-a`, displayName: "A" });
  const b = await upsertUser(db, { issuer, sub: `${tag}-b`, displayName: "B" });
  const supplement = newId();
  const annotation = newId();
  await asUser(db, a, async (tx) => {
    await tx.insert(intakeLogs).values({ userId: a, date: "2026-10-07", kcal: 2100, kcalAt: AT });
    await tx
      .insert(supplements)
      .values({ id: supplement, userId: a, name: "Créatine", nameAt: AT, kind: "creatine" });
    await tx.insert(supplementLogs).values({
      userId: a,
      supplementId: supplement,
      date: "2026-10-07",
      taken: true,
      takenAt: AT,
    });
    await tx
      .insert(annotations)
      .values({ id: annotation, userId: a, date: "2026-09-15", kind: "note", fieldsAt: AT });
    await tx
      .insert(bodyMetrics)
      .values({ userId: a, date: "2026-10-06", waistCm: 82.5, waistAt: AT });
  });
  return { a, b, supplement, annotation };
}

const TABLES = { intakeLogs, supplements, supplementLogs, annotations } as const;

describe("the tracking tables as belay_app", () => {
  it("show each person their own rows only", async () => {
    const { a, b } = await twoPeople("tr-read");
    for (const [name, table] of Object.entries(TABLES)) {
      expect(await asUser(db, b, (tx) => tx.select().from(table)), name).toEqual([]);
      expect(await asUser(db, a, (tx) => tx.select().from(table)), name).toHaveLength(1);
    }
  });

  it("refuse a row written for someone else", async () => {
    const { a, b, supplement } = await twoPeople("tr-insert");
    const writes = [
      (tx: Tx) =>
        tx.insert(intakeLogs).values({ userId: a, date: "2026-10-01", kcal: 1800, kcalAt: AT }),
      (tx: Tx) =>
        tx
          .insert(supplements)
          .values({ id: newId(), userId: a, name: "Fer", nameAt: AT, kind: "other" }),
      (tx: Tx) =>
        tx.insert(supplementLogs).values({
          userId: a,
          supplementId: supplement,
          date: "2026-10-01",
          taken: true,
          takenAt: AT,
        }),
      (tx: Tx) =>
        tx
          .insert(annotations)
          .values({ id: newId(), userId: a, date: "2026-10-01", kind: "deload", fieldsAt: AT }),
    ];
    for (const write of writes) await expect(asUser(db, b, write)).rejects.toMatchObject(denied);
  });

  it("update nothing of someone else's", async () => {
    const { a, b } = await twoPeople("tr-update");
    const updated = await asUser(db, b, async (tx) => [
      ...(await tx.update(intakeLogs).set({ kcal: 1 }).where(eq(intakeLogs.userId, a)).returning()),
      ...(await tx
        .update(supplements)
        .set({ name: "x" })
        .where(eq(supplements.userId, a))
        .returning()),
      ...(await tx
        .update(supplementLogs)
        .set({ taken: false })
        .where(eq(supplementLogs.userId, a))
        .returning()),
      ...(await tx
        .update(annotations)
        .set({ label: "x" })
        .where(eq(annotations.userId, a))
        .returning()),
    ]);
    expect(updated).toEqual([]);
  });

  it("never tick someone else's supplement, even under one's own name", async () => {
    const { b, supplement } = await twoPeople("tr-tick");
    await expect(
      asUser(db, b, (tx) =>
        tx.insert(supplementLogs).values({
          userId: b,
          supplementId: supplement, // A's
          date: "2026-10-07",
          taken: true,
          takenAt: AT,
        }),
      ),
    ).rejects.toMatchObject(foreignKey);
  });

  it("can never delete, not even one's own rows", async () => {
    const { a } = await twoPeople("tr-delete");
    for (const [name, table] of Object.entries(TABLES))
      await expect(
        asUser(db, a, (tx) => tx.delete(table).where(eq(table.userId, a))),
        name,
      ).rejects.toMatchObject(denied);
  });

  it("keep every value inside its bounds", async () => {
    const { a, supplement, annotation } = await twoPeople("tr-check");
    const refused = [
      (tx: Tx) => tx.update(intakeLogs).set({ kcal: 10_001 }).where(eq(intakeLogs.userId, a)),
      (tx: Tx) => tx.update(intakeLogs).set({ proteinG: -1 }).where(eq(intakeLogs.userId, a)),
      (tx: Tx) => tx.update(bodyMetrics).set({ waistCm: 39.9 }).where(eq(bodyMetrics.userId, a)),
      (tx: Tx) => tx.update(bodyMetrics).set({ neckCm: 80.1 }).where(eq(bodyMetrics.userId, a)),
      (tx: Tx) => tx.update(bodyMetrics).set({ hipCm: 49.5 }).where(eq(bodyMetrics.userId, a)),
      (tx: Tx) =>
        tx.update(supplements).set({ kind: "vitamin" }).where(eq(supplements.id, supplement)),
      (tx: Tx) => tx.update(supplements).set({ name: "" }).where(eq(supplements.id, supplement)),
      (tx: Tx) =>
        tx
          .update(supplements)
          .set({ name: "x".repeat(41) })
          .where(eq(supplements.id, supplement)),
      (tx: Tx) =>
        tx.update(annotations).set({ kind: "holiday" }).where(eq(annotations.id, annotation)),
      (tx: Tx) =>
        tx
          .update(annotations)
          .set({ label: "x".repeat(81) })
          .where(eq(annotations.id, annotation)),
      (tx: Tx) => tx.update(users).set({ formula: "other" }).where(eq(users.id, a)),
      (tx: Tx) => tx.update(users).set({ heightCm: 231 }).where(eq(users.id, a)),
      (tx: Tx) => tx.update(users).set({ birthYear: 1899 }).where(eq(users.id, a)),
    ];
    for (const write of refused)
      await expect(asUser(db, a, write)).rejects.toMatchObject(checkViolation);
  });

  it("read the measurements back as numbers, to the tenth", async () => {
    const { a } = await twoPeople("tr-numeric");
    const [row] = await asUser(db, a, (tx) =>
      tx.select({ waist: bodyMetrics.waistCm, weight: bodyMetrics.weightKg }).from(bodyMetrics),
    );
    expect(row).toEqual({ waist: 82.5, weight: null });
  });

  it("disappear with their person", async () => {
    const { a } = await twoPeople("tr-cascade");
    await owner.delete(users).where(eq(users.id, a));
    for (const [name, table] of Object.entries(TABLES))
      expect(await owner.select().from(table).where(eq(table.userId, a)), name).toEqual([]);
  });
});

describe("the profile on users as belay_app", () => {
  it("lets a person write and clear their own profile", async () => {
    const { a, b } = await twoPeople("pr-own");
    const [row] = await asUser(db, a, (tx) =>
      tx
        .update(users)
        .set({
          formula: "male",
          formulaAt: AT,
          birthYear: 1995,
          birthYearAt: AT,
          heightCm: 178,
          heightAt: AT,
        })
        .where(eq(users.id, a))
        .returning({
          formula: users.formula,
          birthYear: users.birthYear,
          heightCm: users.heightCm,
        }),
    );
    expect(row).toEqual({ formula: "male", birthYear: 1995, heightCm: 178 });
    const cleared = await asUser(db, a, (tx) =>
      tx.update(users).set({ heightCm: null, heightAt: AT }).where(eq(users.id, a)).returning(),
    );
    expect(cleared[0]?.heightCm).toBeNull();
    const other = await asUser(db, b, (tx) =>
      tx.update(users).set({ heightCm: 150 }).where(eq(users.id, a)).returning(),
    );
    expect(other).toEqual([]);
  });
});

describe("the database catalogue, after 0004", () => {
  it("has a policy on each new table for belay_app, using and checking the person", async () => {
    const rows = await owner.execute<{ tablename: string; qual: string; with_check: string }>(
      sql`select tablename, qual, with_check from pg_policies
          where tablename in ('intake_logs', 'supplements', 'supplement_logs', 'annotations')
          order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual([
      "annotations",
      "intake_logs",
      "supplement_logs",
      "supplements",
    ]);
    for (const r of rows) {
      expect(r.qual).toContain("app.user_id");
      expect(r.with_check).toContain("app.user_id");
    }
  });

  it("grants belay_app no DELETE on any table", async () => {
    const rows = await owner.execute<{ table_name: string }>(
      sql`select table_name from information_schema.role_table_grants
          where grantee = 'belay_app' and privilege_type = 'DELETE'`,
    );
    expect(rows).toEqual([]);
  });
});
