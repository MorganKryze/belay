// The operator's command, run in the image as `node admin.js`: it moves an account to a new
// identity, or deletes one for a person who can no longer sign in. It connects as the owner through
// DATABASE_URL, reads only an account's id and identity, and prints nothing of the person.
import { appendFileSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const USAGE = [
  "usage: node admin.js rebind --from <issuer> <subject> --to <issuer> <subject> [--force-issuer]",
  "       node admin.js delete --issuer <issuer> --subject <subject>",
  "       node admin.js delete --id <account id>",
].join("\n");

type Io = {
  databaseUrl: string | undefined;
  // The instance's OIDC_ISSUER.
  issuer: string | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
  // The server's log, where an operator looks after restoring a backup.
  log?: (line: string) => void;
  // Each statement sent, for the test that checks which columns are read.
  debug?: (query: string) => void;
};

type Command =
  | { name: "rebind"; from: [string, string]; to: [string, string]; toInstance?: boolean }
  | { name: "delete"; identity: [string, string] }
  | { name: "delete"; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Refusal extends Error {}

// OpenID Connect caps a subject at 255 characters; an issuer is a URL, bounded the same way.
const SUBJECT_MAX = 255;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ISSUER_MAX = 2048;

// An issuer as a key: the parser's form, without the trailing slash that names the same provider.
function issuerKey(value: string | undefined): string | undefined {
  if (value === undefined || value.length > ISSUER_MAX) return undefined;
  const url = URL.parse(value);
  // As OIDC_ISSUER: plain http only for a provider on this machine.
  const local = url?.protocol === "http:" && LOOPBACK.has(url.hostname);
  if (!url || !(url.protocol === "https:" || local) || !url.hostname) return undefined;
  return url.href.replace(/\/+$/, "");
}

const subject = (value: string | undefined) =>
  value !== undefined && value !== "" && value.length <= SUBJECT_MAX;

function parse(args: string[], instanceIssuer: string | undefined): Command | string {
  if (args[0] === "rebind" && args[1] === "--from" && args[4] === "--to") {
    const force = args.length === 8 && args[7] === "--force-issuer";
    const [, , fromIss, fromSub, , toIss, toSub] = args;
    if (
      (args.length === 7 || force) &&
      issuerKey(fromIss) &&
      issuerKey(toIss) &&
      subject(fromSub) &&
      subject(toSub)
    ) {
      if (force) return { name: "rebind", from: [fromIss!, fromSub!], to: [toIss!, toSub!] };
      // Stored as this instance names its provider, so the next sign-in finds the account.
      if (instanceIssuer && issuerKey(toIss) === issuerKey(instanceIssuer)) {
        return {
          name: "rebind",
          from: [fromIss!, fromSub!],
          to: [instanceIssuer, toSub!],
          toInstance: true,
        };
      }
      return "the new issuer must be this instance's OIDC_ISSUER (add --force-issuer to move it elsewhere)";
    }
  }
  if (
    args[0] === "delete" &&
    args.length === 5 &&
    args[1] === "--issuer" &&
    args[3] === "--subject" &&
    issuerKey(args[2]) &&
    subject(args[4])
  ) {
    return { name: "delete", identity: [args[2]!, args[4]!] };
  }
  if (args[0] === "delete" && args.length === 3 && args[1] === "--id" && UUID.test(args[2]!)) {
    return { name: "delete", id: args[2]!.toLowerCase() };
  }
  return "";
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

// The issuer an earlier sign-in through this provider saved, else OIDC_ISSUER as written: the
// provider's own text is known only once someone has signed in through it. Two saved spellings of
// it leave no form to pick: the operator names one with --force-issuer.
async function signInForm(tx: postgres.TransactionSql, issuer: string): Promise<string> {
  const key = issuerKey(issuer);
  const saved = await tx<{ oidc_issuer: string }[]>`
    select distinct oidc_issuer from users order by oidc_issuer`;
  const same = saved.filter((row) => issuerKey(row.oidc_issuer) === key).map((r) => r.oidc_issuer);
  if (same.length > 1) {
    const listed = same.map((form) => JSON.stringify(form)).join(", ");
    throw new Refusal(
      `accounts hold ${same.length} spellings of this issuer (${listed}): pass the one to keep with --force-issuer`,
    );
  }
  return same[0] ?? issuer;
}

export async function runAdmin(args: string[], io: Io): Promise<number> {
  const command = parse(args, io.issuer);
  if (typeof command === "string") {
    io.err(USAGE);
    if (command) io.err(command);
    return 2;
  }
  let sql: postgres.Sql | undefined;
  try {
    sql = open(io.databaseUrl, io.debug);
    const db = sql;
    if (command.name === "rebind") {
      // Issuer and subject only: no health data in the operator's terminal.
      const saved = await db.begin(async (tx) => {
        const [fromIss, fromSub] = command.from;
        const [given, toSub] = command.to;
        // Saved as this instance's sign-ins write it (the provider's iss), not as OIDC_ISSUER reads.
        const toIss = command.toInstance ? await signInForm(tx, given) : given;
        const [account] = await tx<{ id: string }[]>`
          select id from users where oidc_issuer = ${fromIss} and oidc_sub = ${fromSub} for update`;
        if (!account) throw new Refusal("no account with that identity");
        const [taken] = await tx<{ id: string }[]>`
          select id from users where oidc_issuer = ${toIss} and oidc_sub = ${toSub}`;
        if (taken) throw new Refusal("an account already has that identity");
        await tx`update users set oidc_issuer = ${toIss}, oidc_sub = ${toSub} where id = ${account.id}`;
        await tx`delete from sessions where user_id = ${account.id}`;
        return `${toIss} ${toSub}`;
      });
      io.out(`rebound ${command.from.join(" ")} to ${saved}`);
    } else {
      // Looked up without a lock, then erased in the server's order: the account's sync key, then
      // its row (belay_erase_account), so a running sync ends first and nothing deadlocks.
      const [iss, sub] = "id" in command ? [] : command.identity;
      const [found] =
        "id" in command
          ? await db<{ id: string }[]>`select id from users where id = ${command.id}::uuid`
          : await db<{ id: string }[]>`
              select id from users where oidc_issuer = ${iss!} and oidc_sub = ${sub!}`;
      const missing = "id" in command ? "no account with that id" : "no account with that identity";
      if (!found) throw new Refusal(missing);
      const id = found.id;
      await db.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
        // Still that account, under that identity, once the sync that held it is done.
        const [still] =
          "id" in command
            ? await tx<{ id: string }[]>`select id from users where id = ${id}::uuid for update`
            : await tx<{ id: string }[]>`
                select id from users
                where id = ${id}::uuid and oidc_issuer = ${iss!} and oidc_sub = ${sub!} for update`;
        if (!still) throw new Refusal(missing);
        await tx`select from belay_erase_account(${id}::uuid)`;
      });
      // The server's own line for a deletion (api/routes.ts), in both places.
      const line = `account deleted: ${id} at ${new Date().toISOString()}`;
      io.out(line);
      io.log?.(line);
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
// `docker compose exec` keeps only the server's own output in `docker compose logs`: the line goes
// to the server's stdout as well, which the same user may write to. Elsewhere stdout alone holds it.
function containerLog(line: string) {
  const server = "/proc/1/fd/1";
  if (process.pid === 1 || !existsSync(server)) return;
  try {
    appendFileSync(server, `${line}\n`);
  } catch {
    console.error("could not write to the server's log: keep the line above");
  }
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAdmin(process.argv.slice(2), {
    databaseUrl: process.env.DATABASE_URL,
    issuer: process.env.OIDC_ISSUER,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
    log: containerLog,
  });
}
/* v8 ignore stop */
