import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { oidcProvider } from "./auth/oidc";
import { APP_ROLE, loadConfig } from "./config";
import { connect, enableAppLogin, runMigrations, sessionRole } from "./db/client";

// Drizzle wraps driver failures in "Failed query: <sql>": the reason (refused connection, unknown
// host, bad password, failing migration) sits at the end of the cause chain. Name, message and code
// only, and never the connection string.
function rootCause(err: unknown): string {
  let cause = err;
  while (cause instanceof Error && cause.cause instanceof Error) cause = cause.cause;
  if (!(cause instanceof Error)) return "unknown error";
  const code = (cause as { code?: unknown }).code;
  // A Drizzle wrapper with nothing under it still carries the statement and its parameters.
  const wrapper = cause.message.startsWith("Failed query:");
  const text = (!wrapper && cause.message) || (typeof code === "string" ? code : cause.name);
  return typeof code === "string" && !text.includes(code) ? `${text} (${code})` : text;
}

function open(url: string, name: string) {
  try {
    return connect(url);
  } catch {
    // The parser's own message ("Invalid URL") is unhelpful, and its error carries the URL, secret
    // included, so it is deliberately not attached as a cause.
    throw new Error(`Invalid configuration:\n${name} is not a valid PostgreSQL connection URL`);
  }
}

export async function start(env: Record<string, string | undefined>) {
  const cfg = loadConfig(env);
  const owner = open(cfg.databaseUrl, "DATABASE_URL");
  let conn: ReturnType<typeof connect>;
  try {
    conn = open(cfg.appDatabaseUrl, "APP_DATABASE_URL");
  } catch (err) {
    await owner.client.end({ timeout: 1 });
    throw err;
  }
  const { db, client } = conn;
  try {
    await runMigrations(owner.db, cfg.migrationsDir);
  } catch (err) {
    await Promise.all([owner.client.end({ timeout: 1 }), client.end({ timeout: 1 })]);
    throw new Error(`Database unreachable or migration failed: ${rootCause(err)}`, { cause: err });
  }
  try {
    await enableAppLogin(owner.db, cfg.appPassword);
  } catch (err) {
    await Promise.all([owner.client.end({ timeout: 1 }), client.end({ timeout: 1 })]);
    // No cause: Drizzle's error carries the statement and its parameters, the password included.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Cannot set the belay_app password: ${rootCause(err)}`);
  }
  // The owner's work is done: from here on, nothing runs as the table owner.
  await owner.client.end({ timeout: 5 });
  try {
    const role = await sessionRole(db);
    if (role !== APP_ROLE) throw new Error(`logged in as ${role}`);
  } catch (err) {
    await client.end({ timeout: 1 });
    throw new Error(`Cannot connect as ${APP_ROLE}: ${rootCause(err)}`, { cause: err });
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
