import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it, inject } from "vitest";
import { start } from "../src/server";
import { testEnv } from "./config";
import { testDb } from "./db";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolve(port));
    });
  });
}

const webDist = mkdtempSync(join(tmpdir(), "belay-start-"));
const owner = testDb();
// The real database: the owner runs the migrations, the server serves as belay_app.
const live = (overrides: Record<string, string> = {}) =>
  testEnv({
    DATABASE_URL: inject("databaseUrl"),
    APP_DATABASE_URL: inject("appDatabaseUrl"),
    WEB_DIST: webDist,
    ...overrides,
  });

describe("start", () => {
  it("fails fast with a clear message when the database is unreachable", async () => {
    await expect(
      start(testEnv({ DATABASE_URL: "postgres://nobody:nothing@localhost:1/none" })),
    ).rejects.toThrow(/Database unreachable/);
  });

  it("fails fast on invalid configuration", async () => {
    await expect(start({})).rejects.toThrow(/Invalid configuration/);
  });

  it("names the cause of an unreachable database and never echoes the credentials", async () => {
    const err = await start(
      testEnv({ DATABASE_URL: "postgres://nobody:hunter2secret@localhost:1/none" }),
    ).catch((e: Error) => e);
    expect((err as Error).message).toMatch(/Database unreachable.*ECONNREFUSED/);
    expect((err as Error).message).not.toContain("hunter2secret");
  });

  it("rejects a malformed DATABASE_URL without echoing it", async () => {
    const err = await start(testEnv({ DATABASE_URL: "postgres://u:p%zz@localhost:1/none" })).catch(
      (e: Error) => e,
    );
    expect((err as Error).message).toMatch(/Invalid configuration[\s\S]*DATABASE_URL/);
    expect((err as Error).message).not.toContain("p%zz");
  });

  it("serves requests, then shuts down and frees the port", async () => {
    const port = await freePort();
    const server = await start(live({ PORT: String(port) }));
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await server.close();
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });

  it("serves as belay_app once the owner has run the migrations", async () => {
    const port = await freePort();
    const tag = `belay-start-${port}`;
    const server = await start(
      live({
        DATABASE_URL: `${inject("databaseUrl")}?application_name=${tag}`,
        APP_DATABASE_URL: `${inject("appDatabaseUrl")}?application_name=${tag}`,
        PORT: String(port),
      }),
    );
    try {
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
      const roles = async () => {
        const rows = await owner.db.execute<{ usename: string }>(
          sql`select usename from pg_stat_activity where application_name = ${tag}`,
        );
        return [...new Set(rows.map((r) => r.usename))];
      };
      // The owner's pool is closed once the migrations are done; only the app's remains.
      await expect.poll(roles).toEqual(["belay_app"]);
    } finally {
      await server.close();
    }
  });

  it("starts with an app password that needs quoting and percent-encoding", async () => {
    const password = decodeURIComponent(new URL(inject("appDatabaseUrl")).password);
    for (const c of ["'", '"', "\\", "%", "@", ":", "/", "?", "#", " "]) {
      expect(password).toContain(c);
    }
    const port = await freePort();
    const server = await start(live({ PORT: String(port) }));
    try {
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
    } finally {
      await server.close();
    }
  });

  it("fails fast with a clear message when the port is taken", async () => {
    const port = await freePort();
    const first = await start(live({ PORT: String(port) }));
    try {
      await expect(start(live({ PORT: String(port) }))).rejects.toThrow(
        /Cannot listen on port \d+: .*EADDRINUSE/,
      );
    } finally {
      await first.close();
    }
  });
});
