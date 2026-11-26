import { sql } from "drizzle-orm";
import { describe, expect, inject, it } from "vitest";
import { runAdmin } from "../src/admin";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { createSession, upsertUser } from "../src/db/identity";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

const { db } = appDb();
const owner = testDb().db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });
const OLD = "https://old-idp.test";
const NEW = "https://new-idp.test";

async function admin(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const queries: string[] = [];
  const log: string[] = [];
  const code = await runAdmin(args, {
    databaseUrl: inject("databaseUrl"),
    // This instance's OIDC_ISSUER: the one identity provider a rebind may move an account to.
    issuer: NEW,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    log: (line) => log.push(line),
    debug: (query) => queries.push(query),
  });
  return { code, out, err, queries, log };
}

async function session(user: string) {
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  return { authorization: `Bearer ${token}` };
}

async function sessionCount(user: string) {
  const rows = await owner.execute<{ n: number }>(
    sql`select count(*)::int as n from sessions where user_id = ${user}::uuid`,
  );
  return rows[0]!.n;
}

async function identityOf(user: string) {
  const rows = await owner.execute<{ iss: string; sub: string }>(
    sql`select oidc_issuer as iss, oidc_sub as sub from users where id = ${user}::uuid`,
  );
  return rows[0];
}

describe("the operator's command", () => {
  it("rebinds one account and ends its sessions; the next sign-in with the new identity opens it", async () => {
    const user = await upsertUser(db, { issuer: OLD, sub: "moved", displayName: "Moved" });
    const other = await upsertUser(db, { issuer: OLD, sub: "stays", displayName: "Stays" });
    const headers = await session(user);
    await session(other);
    const res = await admin(["rebind", "--from", OLD, "moved", "--to", NEW, "moved-2"]);
    expect(res).toMatchObject({ code: 0, out: ["rebound"], err: [] });
    expect(await identityOf(user)).toEqual({ iss: NEW, sub: "moved-2" });
    expect(await sessionCount(user)).toBe(0);
    expect(await sessionCount(other)).toBe(1);
    expect((await app.request("/api/me", { headers })).status).toBe(401);
    expect(await upsertUser(db, { issuer: NEW, sub: "moved-2", displayName: "Moved" })).toBe(user);
  });

  it("refuses an unknown identity and an identity already taken, changing nothing", async () => {
    const a = await upsertUser(db, { issuer: OLD, sub: "taken-a", displayName: "A" });
    const b = await upsertUser(db, { issuer: NEW, sub: "taken-b", displayName: "B" });
    await session(a);
    const unknown = await admin(["rebind", "--from", OLD, "nobody", "--to", NEW, "free"]);
    expect(unknown).toMatchObject({ code: 1, out: [], err: ["no account with that identity"] });
    const taken = await admin(["rebind", "--from", OLD, "taken-a", "--to", NEW, "taken-b"]);
    expect(taken).toMatchObject({
      code: 1,
      out: [],
      err: ["an account already has that identity"],
    });
    expect(await identityOf(a)).toEqual({ iss: OLD, sub: "taken-a" });
    expect(await identityOf(b)).toEqual({ iss: NEW, sub: "taken-b" });
    expect(await sessionCount(a)).toBe(1);
    const gone = await admin(["delete", "--issuer", OLD, "--subject", "nobody"]);
    expect(gone).toMatchObject({ code: 1, out: [], err: ["no account with that identity"] });
  });

  it("moves only one of two accounts rebound to the same identity at once", async () => {
    await upsertUser(db, { issuer: OLD, sub: "race-a", displayName: "A" });
    await upsertUser(db, { issuer: OLD, sub: "race-b", displayName: "B" });
    const results = await Promise.all(
      ["race-a", "race-b"].map((sub) => admin(["rebind", "--from", OLD, sub, "--to", NEW, "race"])),
    );
    expect(results.map((r) => r.code).sort()).toEqual([0, 1]);
    expect(results.flatMap((r) => r.err)).toEqual(["an account already has that identity"]);
  });

  it("moves an account to another provider only when told to, and takes this instance's issuer as written", async () => {
    const user = await upsertUser(db, { issuer: OLD, sub: "provider", displayName: "P" });
    const slash = await admin(["rebind", "--from", OLD, "provider", "--to", `${NEW}/`, "p-1"]);
    expect(slash).toMatchObject({ code: 0, out: ["rebound"] });
    expect(await identityOf(user)).toEqual({ iss: NEW, sub: "p-1" });
    const other = "https://elsewhere.test";
    const args = ["rebind", "--from", NEW, "p-1", "--to", other, "p-2"];
    expect((await admin(args)).code).toBe(2);
    expect(await admin([...args, "--force-issuer"])).toMatchObject({ code: 0, out: ["rebound"] });
    expect(await identityOf(user)).toEqual({ iss: other, sub: "p-2" });
    expect(
      (await admin(["rebind", "--from", other, "p-2", "--to", NEW, "s".repeat(255)])).code,
    ).toBe(0);
  });

  it("exits 2 on bad arguments", async () => {
    for (const args of [
      [],
      ["frobnicate"],
      ["rebind", "--from", OLD, "x"],
      ["rebind", "--from", OLD, "x", "--into", NEW, "y"],
      ["rebind", "--from", OLD, "x", "--to", NEW, "y", "extra"],
      ["delete", "--issuer", OLD],
      ["delete", "--subject", "x", "--issuer", OLD],
      ["delete", "--issuer", "", "--subject", "x"],
      ["delete", "--id", "not-a-uuid"],
      ["delete", "--id", "0190f5a0-0000-7000-8000-00000000000"],
      ["delete", "--id"],
      ["rebind", "--from", OLD, "x", "--to", "not-a-url", "sub"],
      ["rebind", "--from", OLD, "x", "--to", "http://new-idp.test", "sub"],
      ["rebind", "--from", "not-a-url", "x", "--to", NEW, "sub"],
      ["rebind", "--from", OLD, "x", "--to", "https://elsewhere.test", "sub"],
      ["rebind", "--from", OLD, "x", "--to", NEW, "s".repeat(256)],
      ["rebind", "--from", `${OLD}/${"p".repeat(2048)}`, "x", "--to", NEW, "sub"],
      ["delete", "--issuer", "x", "--subject", "y"],
      ["delete", "--issuer", OLD, "--subject", "s".repeat(256)],
    ]) {
      const res = await admin(args);
      expect(res.code, args.join(" ")).toBe(2);
      expect(res.out).toEqual([]);
      expect(res.err[0]).toMatch(/^usage:/);
      expect(res.queries).toEqual([]);
    }
  });

  it("names a bad or unreachable database without printing its address", async () => {
    const run = async (databaseUrl: string | undefined) => {
      const err: string[] = [];
      const code = await runAdmin(["delete", "--issuer", OLD, "--subject", "x"], {
        databaseUrl,
        issuer: NEW,
        out: () => {},
        err: (line) => err.push(line),
      });
      return { code, err };
    };
    for (const url of [undefined, "not a url", "postgres://belay:hunter2%zz@db/belay"]) {
      expect(await run(url)).toEqual({
        code: 1,
        err: ["DATABASE_URL is not a valid PostgreSQL connection URL"],
      });
    }
    const down = await run("postgres://belay:hunter2@127.0.0.1:1/belay");
    expect(down.code).toBe(1);
    expect(down.err).toHaveLength(1);
    expect(down.err[0]).toMatch(/^failed: /);
    expect(down.err[0]).not.toContain("hunter2");
  });

  it("deletes by identity and prints only the id and the time", async () => {
    const user = await upsertUser(db, { issuer: OLD, sub: "leaving", displayName: "Leaving" });
    const headers = await session(user);
    const before = Date.now();
    const res = await admin(["delete", "--issuer", OLD, "--subject", "leaving"]);
    expect(res.code).toBe(0);
    expect(res.err).toEqual([]);
    expect(res.out).toHaveLength(1);
    // The server's own line, in the server's log too, so a restore can replay it.
    expect(res.log).toEqual(res.out);
    const [, id, at] = /^account deleted: (\S+) at (\S+)$/.exec(res.out[0]!)!;
    expect(id).toBe(user);
    expect(new Date(at!).toISOString()).toBe(at);
    expect(Date.parse(at!)).toBeGreaterThanOrEqual(before - 1000);
    expect(await identityOf(user)).toBeUndefined();
    // Its device learns the account is gone, as after a deletion from the app.
    expect((await app.request("/api/me", { headers })).status).toBe(410);
  });

  it("deletes by a logged id, as a restore replays it", async () => {
    const user = await upsertUser(db, { issuer: OLD, sub: "replayed", displayName: "Replayed" });
    const res = await admin(["delete", "--id", user.toUpperCase()]);
    expect(res.code).toBe(0);
    expect(res.out[0]).toMatch(new RegExp(`^account deleted: ${user} at `));
    expect(await identityOf(user)).toBeUndefined();
    const again = await admin(["delete", "--id", user]);
    expect(again).toMatchObject({ code: 1, out: [], err: ["no account with that id"] });
  });

  it("reads no other column", async () => {
    await upsertUser(db, { issuer: OLD, sub: "audited", displayName: "Private Name" });
    const rebind = await admin(["rebind", "--from", OLD, "audited", "--to", NEW, "audited"]);
    const del = await admin(["delete", "--issuer", NEW, "--subject", "audited"]);
    expect([rebind.code, del.code]).toEqual([0, 0]);
    const queries = [...rebind.queries, ...del.queries];
    expect(queries.length).toBeGreaterThan(0);
    const read = new Set<string>();
    for (const query of queries) {
      expect(query).not.toMatch(/\*|returning/i);
      for (const [, list] of query.matchAll(/\bselect\s+(.*?)\s+from\b/gis)) {
        for (const column of list!.split(",")) read.add(column.trim());
      }
    }
    expect([...read].sort()).toEqual(["id"]);
    for (const query of queries) {
      const where = [...query.matchAll(/\b(?:where|and)\s+(\w+)\s*=/gi)].map((m) => m[1]);
      for (const column of where)
        expect(["id", "oidc_issuer", "oidc_sub", "user_id"]).toContain(column);
    }
  });
});
