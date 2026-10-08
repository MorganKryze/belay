import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { connect, enableAppLogin, runMigrations } from "../src/db/client";

// Every character that means something in a URL, a space, both quotes and a backslash: the app
// role's password goes through percent-encoding (APP_DATABASE_URL) and format('%L').
const APP_PASSWORD = `p@ss:w/rd?#% "it's"\\`;

export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:18-alpine").start();
  const url = container.getConnectionUri();
  const { db, client } = connect(url);
  await runMigrations(db, "drizzle");
  await enableAppLogin(db, APP_PASSWORD);
  await client.end();
  const appUrl = new URL(url);
  appUrl.username = "belay_app";
  appUrl.password = encodeURIComponent(APP_PASSWORD);
  project.provide("databaseUrl", url);
  project.provide("appDatabaseUrl", appUrl.href);
  return async () => {
    await container.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    appDatabaseUrl: string;
  }
}
