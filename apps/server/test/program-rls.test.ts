import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@belay/shared";
import { SEED_PROGRAM_ID, seedId } from "@belay/shared/training/stored-program";
import { eq, sql } from "drizzle-orm";
import { describe, expect, inject, it } from "vitest";
import { asUser, connect, runMigrations, type Db, type Tx } from "../src/db/client";
import { upsertUser } from "../src/db/identity";
import { activePrograms, programSessions, programSlots, programs, users } from "../src/db/schema";
import { appDb, testDb } from "./db";

// As the server runs: the belay_app login role, row-level security on every query.
const { db } = appDb();
const owner = testDb().db;
const issuer = "https://idp.test";
// drizzle wraps driver errors in DrizzleQueryError; the Postgres error is its `cause`.
const denied = { cause: { code: "42501" } };
const foreignKey = { cause: { code: "23503" } };
const checkViolation = { cause: { code: "23514" } };
const AT = new Date("2026-10-07T17:00:00.000Z");
const SCHEDULE = { mode: "rotation" as const, days: [null, null, null, null, null, null, null] };

// The starting program's ids are the same for every account: the program, session A and its
// first slot.
const PROGRAM = SEED_PROGRAM_ID;
const SESSION_A = seedId(1);
const SLOT_A1 = seedId(0x101);
// Seven session ids, the largest schedule a program holds.
const FULL_WEEK = { mode: "fixed" as const, days: Array.from({ length: 7 }, () => newId()) };

const programOf = (
  userId: string,
  patch: Partial<typeof programs.$inferInsert> = {},
): typeof programs.$inferInsert => ({ userId, id: PROGRAM, schedule: SCHEDULE, ...patch });

const sessionOf = (
  userId: string,
  patch: Partial<typeof programSessions.$inferInsert> = {},
): typeof programSessions.$inferInsert => ({
  userId,
  id: SESSION_A,
  programId: PROGRAM,
  position: 0,
  ...patch,
});

const slotOf = (
  userId: string,
  patch: Partial<typeof programSlots.$inferInsert> = {},
): typeof programSlots.$inferInsert => ({
  userId,
  id: SLOT_A1,
  sessionId: SESSION_A,
  position: 0,
  exerciseId: "ds:0025",
  repMin: 6,
  repMax: 10,
  sets: 3,
  rirMin: 1,
  rirMax: 2,
  restSec: 180,
  warmupSets: 2,
  isMain: true,
  ...patch,
});

// The starting program, active, with its first session and slot, under the same ids, for each
// account given.
async function seed(userId: string) {
  await asUser(db, userId, async (tx) => {
    await tx.insert(programs).values(programOf(userId));
    await tx.insert(activePrograms).values({ userId, programId: PROGRAM });
    await tx.insert(programSessions).values(sessionOf(userId));
    await tx.insert(programSlots).values(slotOf(userId));
  });
}

// A and B, both holding the starting program.
async function twoAccounts(tag: string) {
  const a = await upsertUser(db, { issuer, sub: `${tag}-a`, displayName: "A" });
  const b = await upsertUser(db, { issuer, sub: `${tag}-b`, displayName: "B" });
  await seed(a);
  await seed(b);
  return { a, b };
}

const TABLES = { programs, activePrograms, programSessions, programSlots } as const;
const NEW = ["active_programs", "program_sessions", "program_slots", "programs"];
const NEW_SQL = sql.join(
  NEW.map((t) => sql`${t}`),
  sql`, `,
);

describe("the program as belay_app", () => {
  it("each account sees only its own rows, though both hold the same seed ids", async () => {
    const { a, b } = await twoAccounts("pg-read");
    for (const [name, table] of Object.entries(TABLES)) {
      const seenByB = await asUser(db, b, (tx) => tx.select().from(table));
      expect(seenByB, name).toHaveLength(1);
      expect(
        seenByB.map((r) => r.userId),
        name,
      ).toEqual([b]);
    }
    // B's write on a seed id touches B's row only.
    const changed = await asUser(db, b, async (tx) => [
      ...(await tx
        .update(programSlots)
        .set({ sets: 5, setsAt: AT })
        .where(eq(programSlots.id, SLOT_A1))
        .returning({ userId: programSlots.userId })),
      ...(await tx
        .update(programSessions)
        .set({ name: "Haut", nameAt: AT })
        .where(eq(programSessions.id, SESSION_A))
        .returning({ userId: programSessions.userId })),
      ...(await tx
        .update(programs)
        .set({ schedule: FULL_WEEK, name: "Hiver", nameAt: AT })
        .where(eq(programs.id, PROGRAM))
        .returning({ userId: programs.userId })),
      ...(await tx
        .update(activePrograms)
        .set({ at: AT })
        .returning({ userId: activePrograms.userId })),
    ]);
    expect(changed).toEqual([{ userId: b }, { userId: b }, { userId: b }, { userId: b }]);
    const [slotOfA] = await asUser(db, a, (tx) => tx.select().from(programSlots));
    const [sessionOfA] = await asUser(db, a, (tx) => tx.select().from(programSessions));
    const [programOfA] = await asUser(db, a, (tx) => tx.select().from(programs));
    const [activeOfA] = await asUser(db, a, (tx) => tx.select().from(activePrograms));
    expect(slotOfA).toMatchObject({ userId: a, sets: 3, setsAt: null });
    expect(sessionOfA).toMatchObject({ userId: a, name: null, nameAt: null });
    expect(programOfA).toMatchObject({ userId: a, schedule: SCHEDULE, name: null, nameAt: null });
    expect(activeOfA).toMatchObject({ userId: a, programId: PROGRAM, at: null });
  });

  it("refuses writing a row for another account", async () => {
    const { a, b } = await twoAccounts("pg-insert");
    const other = newId();
    const writes = [
      (tx: Tx) => tx.insert(programs).values(programOf(a, { id: other })),
      (tx: Tx) => tx.insert(activePrograms).values({ userId: a, programId: PROGRAM }),
      (tx: Tx) => tx.insert(programSessions).values(sessionOf(a, { id: other })),
      (tx: Tx) => tx.insert(programSlots).values(slotOf(a, { id: other })),
      // Nor hand one's own row over to someone else.
      (tx: Tx) => tx.update(programSlots).set({ userId: a }).where(eq(programSlots.userId, b)),
      (tx: Tx) => tx.update(activePrograms).set({ userId: a }).where(eq(activePrograms.userId, b)),
    ];
    for (const write of writes) await expect(asUser(db, b, write)).rejects.toMatchObject(denied);
  });

  it("never deletes, not even one's own rows", async () => {
    const { a } = await twoAccounts("pg-delete");
    for (const [name, table] of Object.entries(TABLES))
      await expect(
        asUser(db, a, (tx) => tx.delete(table).where(eq(table.userId, a))),
        name,
      ).rejects.toMatchObject(denied);
  });

  it("a slot never points at a session the account does not have", async () => {
    const { a, b } = await twoAccounts("pg-fk");
    const sessionOnlyA = newId();
    await asUser(db, a, (tx) =>
      tx.insert(programSessions).values(sessionOf(a, { id: sessionOnlyA, position: 1 })),
    );
    const writes = [
      (tx: Tx) =>
        tx.insert(programSlots).values(slotOf(b, { id: newId(), sessionId: sessionOnlyA })),
      (tx: Tx) =>
        tx
          .update(programSlots)
          .set({ sessionId: sessionOnlyA })
          .where(eq(programSlots.id, SLOT_A1)),
      (tx: Tx) => tx.insert(programSlots).values(slotOf(b, { id: newId(), sessionId: newId() })),
    ];
    for (const write of writes)
      await expect(asUser(db, b, write)).rejects.toMatchObject(foreignKey);
    // A's own slot in that session is fine.
    await asUser(db, a, (tx) =>
      tx.insert(programSlots).values(slotOf(a, { id: newId(), sessionId: sessionOnlyA })),
    );
  });

  it("a session never sits in another account's program", async () => {
    const { a, b } = await twoAccounts("pg-place");
    const programOnlyA = newId();
    await asUser(db, a, (tx) => tx.insert(programs).values(programOf(a, { id: programOnlyA })));
    const writes = [
      (tx: Tx) =>
        tx.insert(programSessions).values(sessionOf(b, { id: newId(), programId: programOnlyA })),
      (tx: Tx) =>
        tx
          .update(programSessions)
          .set({ programId: programOnlyA })
          .where(eq(programSessions.id, SESSION_A)),
      (tx: Tx) =>
        tx.insert(programSessions).values(sessionOf(b, { id: newId(), programId: newId() })),
    ];
    for (const write of writes)
      await expect(asUser(db, b, write)).rejects.toMatchObject(foreignKey);
    // A's own session there is fine; B sets a session aside (no program), at a position another
    // already holds; a removed session comes back beside live ones.
    await asUser(db, a, (tx) =>
      tx.insert(programSessions).values(sessionOf(a, { id: newId(), programId: programOnlyA })),
    );
    const removed = newId();
    await asUser(db, b, async (tx) => {
      await tx.insert(programSessions).values(sessionOf(b, { id: newId(), programId: null }));
      await tx.insert(programSessions).values(sessionOf(b, { id: newId() }));
      await tx
        .insert(programSessions)
        .values(sessionOf(b, { id: removed, removed: true, removedAt: AT }));
      await tx
        .update(programSessions)
        .set({ removed: false, removedAt: AT })
        .where(eq(programSessions.id, removed));
    });
    const ofB = await asUser(db, b, (tx) => tx.select().from(programSessions));
    expect(ofB.filter((s) => s.programId === null)).toHaveLength(1);
    expect(ofB.filter((s) => !s.removed)).toHaveLength(4);
  });

  it("the active pointer never names another account's program", async () => {
    const { a, b } = await twoAccounts("pg-active");
    const programOnlyA = newId();
    await asUser(db, a, (tx) => tx.insert(programs).values(programOf(a, { id: programOnlyA })));
    for (const programId of [programOnlyA, newId()])
      await expect(
        asUser(db, b, (tx) => tx.update(activePrograms).set({ programId, at: AT })),
      ).rejects.toMatchObject(foreignKey);
    // A switches to its own second program; B's pointer stays on its own.
    await asUser(db, a, (tx) => tx.update(activePrograms).set({ programId: programOnlyA, at: AT }));
    const [activeOfB] = await asUser(db, b, (tx) => tx.select().from(activePrograms));
    expect(activeOfB).toMatchObject({ userId: b, programId: PROGRAM, at: null });
    // One pointer per account.
    await expect(
      asUser(db, a, (tx) => tx.insert(activePrograms).values({ userId: a, programId: PROGRAM })),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("the database refuses a counted slot past 100 reps and a timed one past 3600 s", async () => {
    const { a } = await twoAccounts("pg-check");
    const slot = eq(programSlots.id, SLOT_A1);
    const session = eq(programSessions.id, SESSION_A);
    const program = eq(programs.id, PROGRAM);
    const refused = [
      (tx: Tx) => tx.update(programSlots).set({ repMax: 101 }).where(slot),
      (tx: Tx) =>
        tx.update(programSlots).set({ measure: "seconds", repMin: 30, repMax: 3601 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ repMin: 0 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ repMin: 11 }).where(slot), // above the max
      (tx: Tx) => tx.update(programSlots).set({ measure: "minutes" }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ sets: 0 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ sets: 11 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ rirMin: 3 }).where(slot), // above the max
      (tx: Tx) => tx.update(programSlots).set({ rirMax: 5 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ rirMin: -1 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ restSec: 901 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ warmupSets: 4 }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ exerciseId: "bench" }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ groupKey: "a-b" }).where(slot),
      (tx: Tx) =>
        tx
          .update(programSlots)
          .set({ groupKey: "x".repeat(17) })
          .where(slot),
      (tx: Tx) => tx.update(programSlots).set({ rule: "deload" }).where(slot),
      (tx: Tx) => tx.update(programSlots).set({ position: 1000 }).where(slot),
      (tx: Tx) => tx.update(programSessions).set({ name: "" }).where(session),
      (tx: Tx) =>
        tx
          .update(programSessions)
          .set({ name: "x".repeat(41) })
          .where(session),
      (tx: Tx) => tx.update(programSessions).set({ position: -1 }).where(session),
      (tx: Tx) => tx.update(programSessions).set({ position: 1000 }).where(session),
      (tx: Tx) => tx.update(programs).set({ name: "" }).where(program),
      (tx: Tx) =>
        tx
          .update(programs)
          .set({ name: "x".repeat(61) })
          .where(program),
      (tx: Tx) =>
        tx
          .update(programs)
          .set({ schedule: { mode: "rotation", days: Array(7).fill("x".repeat(80)) } })
          .where(program),
    ];
    for (const write of refused)
      await expect(asUser(db, a, write)).rejects.toMatchObject(checkViolation);
    // At the bounds: 100 reps counted, 3600 s timed, every other bound at its edge.
    await asUser(db, a, async (tx) => {
      await tx.update(programSlots).set({ repMin: 100, repMax: 100 }).where(slot);
      await tx
        .update(programSlots)
        .set({ measure: "seconds", repMin: 1, repMax: 3600, warmupSets: 0 })
        .where(slot);
      await tx
        .update(programSlots)
        .set({
          sets: 10,
          rirMin: 4,
          rirMax: 4,
          restSec: 900,
          groupKey: "A".repeat(16),
          rule: "no_climbing",
          position: 999,
        })
        .where(slot);
      await tx
        .update(programSessions)
        .set({ name: "x".repeat(40), position: 999 })
        .where(session);
      // Seven session ids fit, and a 60-character name.
      await tx
        .update(programs)
        .set({ schedule: FULL_WEEK, name: "x".repeat(60) })
        .where(program);
    });
  });

  it("disappears with its account", async () => {
    const { a } = await twoAccounts("pg-cascade");
    await owner.delete(users).where(eq(users.id, a));
    for (const [name, table] of Object.entries(TABLES))
      expect(await owner.select().from(table).where(eq(table.userId, a)), name).toEqual([]);
  });
});

describe("the database catalogue, after 0007", () => {
  it("has row-level security and an owner policy on each table, using and checking the account", async () => {
    const rows = await owner.execute<{ tablename: string; qual: string; with_check: string }>(
      sql`select tablename, qual, with_check from pg_policies
          where tablename in (${NEW_SQL}) order by tablename`,
    );
    expect(rows.map((r) => r.tablename)).toEqual(NEW);
    for (const r of rows) {
      expect(r.qual).toContain("app.user_id");
      expect(r.with_check).toContain("app.user_id");
    }
    const rls = await owner.execute<{ relname: string; relrowsecurity: boolean }>(
      sql`select relname, relrowsecurity from pg_class
          where relname in (${NEW_SQL}) order by relname`,
    );
    expect(rls).toEqual(NEW.map((relname) => ({ relname, relrowsecurity: true })));
  });

  it("grants belay_app reading, adding and changing, never deleting or truncating", async () => {
    const rows = await owner.execute<{ table_name: string; privilege_type: string }>(
      sql`select table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'belay_app' and table_name in (${NEW_SQL})
          order by table_name, privilege_type`,
    );
    expect(rows).toEqual(
      NEW.flatMap((table_name) =>
        ["INSERT", "SELECT", "UPDATE"].map((privilege_type) => ({ table_name, privilege_type })),
      ),
    );
  });
});

// Every row of each table, as text in a stable order, and the columns that hold them; a column
// the migration adds is left out of both, so earlier tables compare equal around it.
async function dump(conn: Db, tables: readonly string[], added: string) {
  const out: Record<string, unknown> = {};
  for (const table of tables) {
    const [rows] = await conn.execute<{ rows: string }>(
      sql`select coalesce(json_agg(r order by r), '[]')::text as rows
          from (select (to_jsonb(t) - ${added}::text)::text as r from ${sql.identifier(table)} t) s`,
    );
    const columns = await conn.execute(
      sql`select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = ${table} and column_name <> ${added}
          order by ordinal_position`,
    );
    out[table] = { rows: rows!.rows, columns: [...columns] };
  }
  return out;
}

const publicTables = async (conn: Db) =>
  (
    await conn.execute<{ tablename: string }>(
      sql`select tablename from pg_tables where schemaname = 'public' order by tablename`,
    )
  ).map((r) => r.tablename);

describe("migration 0007", () => {
  it("on a populated database keeps every row of the earlier tables; sessions done gain no recorded session", async () => {
    // The migrations up to 0006 only, from a copy of the folder whose journal stops there.
    const upTo0006 = mkdtempSync(join(tmpdir(), "belay-0006-"));
    cpSync("drizzle", upTo0006, { recursive: true });
    const journalPath = join(upTo0006, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: { idx: number }[];
    };
    journal.entries = journal.entries.filter((e) => e.idx <= 6);
    writeFileSync(journalPath, JSON.stringify(journal));

    await owner.execute(sql`drop database if exists belay_0007`);
    await owner.execute(sql`create database belay_0007`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = "/belay_0007";
    const fresh = connect(url.href);
    try {
      await runMigrations(fresh.db, upTo0006);
      const before = await publicTables(fresh.db);
      expect(before).not.toContain("programs");
      // Raw SQL takes the time as text.
      const at = AT.toISOString();
      const user = newId();
      const workout = newId();
      await fresh.db
        .execute(sql`insert into users (id, oidc_issuer, oidc_sub, display_name, height_cm, height_at)
        values (${user}, ${issuer}, 'populated', 'P', 178, ${at})`);
      await fresh.db
        .execute(sql`insert into workouts (id, user_id, session_code, plan, started_at, ended_at, note, note_at)
        values (${workout}, ${user}, 'C', '[{"exerciseId": "ds:0025"}]'::jsonb, ${at}, ${at}, 'Bien', ${at}),
               (${newId()}, ${user}, 'A', '[{"exerciseId": "ds:0043"}]'::jsonb, ${at}, null, null, null)`);
      await fresh.db.execute(sql`insert into workout_sets
        (id, user_id, workout_id, slot_index, position, exercise_id, warmup, weight_kg, reps, seconds, rir, done_at, fields_at)
        values (${newId()}, ${user}, ${workout}, 0, 3, 'ds:0025', false, 82.5, 8, null, 1, ${at}, ${at}),
               (${newId()}, ${user}, ${workout}, 1, 3, 'ds:2135', false, 0, null, 45, null, ${at}, ${at})`);
      await fresh.db
        .execute(sql`insert into body_metrics (user_id, date, weight_kg, weight_at, waist_cm, waist_at)
        values (${user}, '2026-10-07', 81.4, ${at}, 86.5, ${at})`);
      const rowsBefore = await dump(fresh.db, before, "session_id");

      await runMigrations(fresh.db, "drizzle");

      expect(await dump(fresh.db, before, "session_id")).toEqual(rowsBefore);
      // Sessions done gain the session they came from, empty for every one done before, with no
      // key: a start is never refused for it.
      const [recorded] = await fresh.db.execute<{ n: number; empty: number }>(
        sql`select count(*)::int as n, count(*) filter (where session_id is null)::int as empty
            from workouts`,
      );
      expect(recorded).toEqual({ n: 2, empty: 2 });
      const column = await fresh.db.execute(
        sql`select data_type, is_nullable, column_default from information_schema.columns
            where table_schema = 'public' and table_name = 'workouts' and column_name = 'session_id'`,
      );
      expect([...column]).toEqual([
        { data_type: "uuid", is_nullable: "YES", column_default: null },
      ]);
      const keys = await fresh.db.execute(
        sql`select constraint_name from information_schema.key_column_usage
            where table_name = 'workouts' and column_name = 'session_id'`,
      );
      expect([...keys]).toEqual([]);
      expect(await publicTables(fresh.db)).toEqual([...before, ...NEW].sort());
      for (const table of NEW) {
        const [row] = await fresh.db.execute<{ n: number; rls: boolean }>(
          sql`select (select count(*)::int from ${sql.identifier(table)}) as n,
                     (select relrowsecurity from pg_class where relname = ${table}) as rls`,
        );
        expect(row, table).toEqual({ n: 0, rls: true });
      }
    } finally {
      await fresh.client.end();
      await owner.execute(sql`drop database if exists belay_0007`);
    }
  });
});
