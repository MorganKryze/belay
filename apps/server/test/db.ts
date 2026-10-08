import { afterAll, inject } from "vitest";
import { connect } from "../src/db/client";

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
