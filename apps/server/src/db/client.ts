import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export function connect(url: string) {
  const client = postgres(url, { max: 10, connect_timeout: 10, onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}

export type Db = ReturnType<typeof connect>["db"];
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function runMigrations(db: Db, dir: string): Promise<void> {
  await migrate(db, { migrationsFolder: dir });
}

export function asApp<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role belay_app`);
    return fn(tx);
  });
}

export function asUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role belay_app`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
