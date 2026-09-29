import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { oidcProvider } from "./auth/oidc";
import { loadConfig } from "./config";
import { connect, runMigrations } from "./db/client";

// Drizzle wraps driver failures in "Failed query: <sql>": the reason (refused connection, unknown
// host, bad password, failing migration) sits at the end of the cause chain. Name, message and code
// only, and never the connection string.
function rootCause(err: unknown): string {
  let cause = err;
  while (cause instanceof Error && cause.cause instanceof Error) cause = cause.cause;
  if (!(cause instanceof Error)) return "unknown error";
  const code = (cause as { code?: unknown }).code;
  const text = cause.message || (typeof code === "string" ? code : cause.name);
  return typeof code === "string" && !text.includes(code) ? `${text} (${code})` : text;
}

export async function start(env: Record<string, string | undefined>) {
  const cfg = loadConfig(env);
  let conn: ReturnType<typeof connect>;
  try {
    conn = connect(cfg.databaseUrl);
  } catch {
    // The parser's own message ("Invalid URL") is unhelpful, and its error carries the URL, secret
    // included, so it is deliberately not attached as a cause.
    throw new Error(
      "Invalid configuration:\nDATABASE_URL is not a valid PostgreSQL connection URL",
    );
  }
  const { db, client } = conn;
  try {
    await runMigrations(db, cfg.migrationsDir);
  } catch (err) {
    await client.end({ timeout: 1 });
    throw new Error(`Database unreachable or migration failed: ${rootCause(err)}`, { cause: err });
  }
  const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });
  let server: ReturnType<typeof serve>;
  let port: number;
  try {
    ({ server, port } = await new Promise<{ server: ReturnType<typeof serve>; port: number }>(
      (resolve, reject) => {
        const s = serve({ fetch: app.fetch, port: cfg.port }, (info) => {
          s.off("error", reject);
          resolve({ server: s, port: info.port });
        });
        s.once("error", reject);
      },
    ));
  } catch (err) {
    await client.end({ timeout: 1 });
    throw new Error(`Cannot listen on port ${cfg.port}: ${rootCause(err)}`, { cause: err });
  }
  console.log(`Belay listening on :${port}, public URL ${cfg.publicUrl.href}`);
  return {
    port,
    // ponytail: no shutdown deadline, so a hung request waits for the orchestrator's SIGKILL.
    // Upgrade: a timer, then server.closeAllConnections().
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await client.end({ timeout: 5 });
    },
  };
}
