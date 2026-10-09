import { defineConfig } from "drizzle-kit";

// Migrations only, never `drizzle-kit push`: the snapshots do not know the grants, policies and
// functions written by hand in the SQL files (0001_rls, 0002_security, the ends of 0003_sync and
// 0004_tracking).
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
