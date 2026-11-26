import { CONSENT_VERSION } from "@belay/shared/sync/limits";
import { eq, sql } from "drizzle-orm";
import { afterAll, inject } from "vitest";
import { asUser, connect, type Db } from "../src/db/client";
import { users } from "../src/db/schema";

// The owner: it runs the migrations, and the tests use it to arrange rows and inspect the catalog.
export function testDb() {
  const conn = connect(inject("databaseUrl"));
  afterAll(() => conn.client.end());
  return conn;
}

// The connection the server serves with: the belay_app role, which owns nothing.
export function appDb() {
  const conn = connect(inject("appDatabaseUrl"));
  afterAll(() => conn.client.end());
  return conn;
}

// The person agreed to the current privacy notice, as the app records it: a sync needs it.
export async function agree(db: Db, userId: string): Promise<void> {
  await asUser(db, userId, (tx) =>
    tx
      .update(users)
      .set({ consentVersion: CONSENT_VERSION, consentAt: sql`now()` })
      .where(eq(users.id, userId)),
  );
}
