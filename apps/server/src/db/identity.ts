import { newId } from "@belay/shared";
import { sql } from "drizzle-orm";
import { asApp, type Db } from "./client";

const days = (n: number) => sql`make_interval(days => ${n}::int)`;

export async function upsertUser(
  db: Db,
  p: { issuer: string; sub: string; displayName: string },
): Promise<string> {
  const rows = await asApp(db, (tx) =>
    tx.execute<{ id: string }>(
      sql`select belay_upsert_user(${newId()}::uuid, ${p.issuer}, ${p.sub}, ${p.displayName}) as id`,
    ),
  );
  return rows[0]!.id;
}

export async function createSession(db: Db, tokenHash: string, userId: string, ttlDays: number) {
  await asApp(db, (tx) =>
    tx.execute(sql`select belay_create_session(${tokenHash}, ${userId}::uuid, ${days(ttlDays)})`),
  );
}

export async function sessionUser(
  db: Db,
  tokenHash: string,
  ttlDays: number,
): Promise<string | null> {
  const rows = await asApp(db, (tx) =>
    tx.execute<{ user_id: string | null }>(
      sql`select belay_session_user(${tokenHash}, ${days(ttlDays)}) as user_id`,
    ),
  );
  return rows[0]?.user_id ?? null;
}

export async function deleteSession(db: Db, tokenHash: string) {
  await asApp(db, (tx) => tx.execute(sql`select belay_delete_session(${tokenHash})`));
}
