// The operator's command, run in the image as `node admin.js`: it moves an account to a new
// identity, or deletes one for a person who can no longer sign in. It connects as the owner through
// DATABASE_URL, reads only an account's id and identity, and prints nothing of the person.
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const USAGE = [
  "usage: node admin.js rebind --from <issuer> <subject> --to <issuer> <subject>",
  "       node admin.js delete --issuer <issuer> --subject <subject>",
].join("\n");

type Io = {
  databaseUrl: string | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
  // Each statement sent, for the test that checks which columns are read.
  debug?: (query: string) => void;
};

type Command =
  | { name: "rebind"; from: [string, string]; to: [string, string] }
  | { name: "delete"; identity: [string, string] };

class Refusal extends Error {}

function parse(args: string[]): Command | undefined {
  const given = (values: (string | undefined)[]) =>
    values.every((v) => v !== undefined && v !== "");
  if (args[0] === "rebind" && args.length === 7 && args[1] === "--from" && args[4] === "--to") {
    const [, , fromIss, fromSub, , toIss, toSub] = args;
    if (given([fromIss, fromSub, toIss, toSub])) {
      return { name: "rebind", from: [fromIss!, fromSub!], to: [toIss!, toSub!] };
    }
  }
  if (
    args[0] === "delete" &&
    args.length === 5 &&
    args[1] === "--issuer" &&
    args[3] === "--subject"
  ) {
    const [, , iss, , sub] = args;
    if (given([iss, sub])) return { name: "delete", identity: [iss!, sub!] };
  }
  return undefined;
}

function open(url: string | undefined, debug: Io["debug"]) {
  try {
    // postgres 4 keeps a malformed %-escape as typed instead of failing: refuse it here.
    const { username, password } = new URL(url ?? "");
    decodeURIComponent(username);
    decodeURIComponent(password);
    return postgres(url!, {
      max: 1,
      connect_timeout: 10,
      onnotice: () => {},
      ...(debug && { debug: (_conn: number, query: string) => debug(query) }),
    });
  } catch {
    // The parser's error carries the URL, secret included: deliberately not attached.
    throw new Refusal("DATABASE_URL is not a valid PostgreSQL connection URL");
  }
}

export async function runAdmin(args: string[], io: Io): Promise<number> {
  const command = parse(args);
  if (!command) {
    io.err(USAGE);
    return 2;
  }
  let sql: postgres.Sql | undefined;
  try {
    sql = open(io.databaseUrl, io.debug);
    const db = sql;
    if (command.name === "rebind") {
      await db.begin(async (tx) => {
        const [fromIss, fromSub] = command.from;
        const [toIss, toSub] = command.to;
        const [account] = await tx<{ id: string }[]>`
          select id from users where oidc_issuer = ${fromIss} and oidc_sub = ${fromSub} for update`;
        if (!account) throw new Refusal("no account with that identity");
        const [taken] = await tx<{ id: string }[]>`
          select id from users where oidc_issuer = ${toIss} and oidc_sub = ${toSub}`;
        if (taken) throw new Refusal("an account already has that identity");
        await tx`update users set oidc_issuer = ${toIss}, oidc_sub = ${toSub} where id = ${account.id}`;
        await tx`delete from sessions where user_id = ${account.id}`;
      });
      io.out("rebound");
    } else {
      const [iss, sub] = command.identity;
      const id = await db.begin(async (tx) => {
        const [account] = await tx<{ id: string }[]>`
          select id from users where oidc_issuer = ${iss} and oidc_sub = ${sub} for update`;
        if (!account) throw new Refusal("no account with that identity");
        await tx`select from belay_erase_account(${account.id}::uuid)`;
        return account.id;
      });
      io.out(`deleted ${id} at ${new Date().toISOString()}`);
    }
    return 0;
  } catch (err) {
    if (err instanceof Refusal) {
      io.err(err.message);
      return 1;
    }
    // The unique identity is the backstop when another rebind took the identity meanwhile.
    if ((err as { code?: unknown }).code === "23505") {
      io.err("an account already has that identity");
      return 1;
    }
    // The code alone: a driver's message can carry the statement, and never the connection string.
    const code = (err as { code?: unknown }).code;
    io.err(`failed: ${typeof code === "string" ? code : "database error"}`);
    return 1;
  } finally {
    await sql?.end({ timeout: 5 });
  }
}

/* v8 ignore start: the entry point, run by node in the image (scripts/smoke.sh) */
const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAdmin(process.argv.slice(2), {
    databaseUrl: process.env.DATABASE_URL,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
}
/* v8 ignore stop */
