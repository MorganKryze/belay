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

// False when the account no longer exists: nothing is opened.
export async function createSession(
  db: Db,
  tokenHash: string,
  userId: string,
  ttlDays: number,
): Promise<boolean> {
  const rows = await asApp(db, (tx) =>
    tx.execute<{ ok: boolean }>(
      sql`select belay_create_session(${tokenHash}, ${userId}::uuid, ${days(ttlDays)}) as ok`,
    ),
  );
  return rows[0]!.ok;
}

// The session's user and the seconds it has left, or null once it has expired or reached the
// absolute cap. Each lookup slides the expiry, up to the cap.
export async function sessionUser(
  db: Db,
  tokenHash: string,
  ttlDays: number,
  maxDays: number,
): Promise<{ userId: string; maxAge: number } | null> {
  const rows = await asApp(db, (tx) =>
    tx.execute<{ user_id: string; max_age: number }>(
      sql`select user_id, max_age from belay_session_user(${tokenHash}, ${days(ttlDays)}, ${days(maxDays)})`,
    ),
  );
  const row = rows[0];
  return row ? { userId: row.user_id, maxAge: row.max_age } : null;
}

export async function deleteSession(db: Db, tokenHash: string) {
  await asApp(db, (tx) => tx.execute(sql`select belay_delete_session(${tokenHash})`));
}

// The deleted account's id, or null when this token opens no live session.
export async function deleteAccount(db: Db, tokenHash: string): Promise<string | null> {
  const rows = await asApp(db, (tx) =>
    tx.execute<{ id: string | null }>(sql`select belay_delete_account(${tokenHash}) as id`),
  );
  return rows[0]!.id;
}

export async function tokenEnded(db: Db, tokenHash: string): Promise<boolean> {
  const rows = await asApp(db, (tx) =>
    tx.execute<{ ended: boolean }>(sql`select belay_token_ended(${tokenHash}) as ended`),
  );
  return rows[0]!.ended;
}
