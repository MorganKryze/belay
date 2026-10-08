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

// Gives the app's role its login and the password of APP_DATABASE_URL; the owner runs it after the
// migrations, at every start. A utility statement takes no bind parameter: format('%L') quotes the
// password on the server, so no character of it can end the literal.
// ponytail: the password travels inside the statement, so it lands in the server log when
// log_statement is 'ddl' or 'all', and a failing ALTER ROLE is logged with it under the default
// log_min_error_statement=error. Upgrade: send a SCRAM verifier computed here instead (fixes both).
// ponytail: belay_app is one role per cluster: two instances sharing a PostgreSQL cluster must share
// BELAY_APP_PASSWORD, or each start locks the other out. Upgrade: a role name per instance.
export async function enableAppLogin(owner: Db, password: string): Promise<void> {
  const [row] = await owner.execute<{ stmt: string }>(
    sql`select format('alter role belay_app with login password %L', ${password}::text) as stmt`,
  );
  await owner.execute(sql.raw(row!.stmt));
}

// The role a pool really logs in as: checked once at startup, so the app never serves as the owner.
export async function sessionRole(db: Db): Promise<string> {
  const [row] = await db.execute<{ role: string }>(sql`select session_user as role`);
  return row!.role;
}
