import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { connect, runMigrations } from "../src/db/client";

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const url = container.getConnectionUri();
  const { db, client } = connect(url);
  await runMigrations(db, "drizzle");
  await client.end();
  project.provide("databaseUrl", url);
  return async () => {
    await container.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
