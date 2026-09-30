import { afterAll, inject } from "vitest";
import { connect } from "../src/db/client";

export function testDb() {
  const conn = connect(inject("databaseUrl"));
  afterAll(() => conn.client.end());
  return conn;
}
