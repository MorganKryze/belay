import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newId } from "@belay/shared";
import { CONSENT_VERSION } from "@belay/shared/sync/limits";
import { eq, sql } from "drizzle-orm";
import { describe, expect, inject, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { asUser, connect, runMigrations } from "../src/db/client";
import { createSession, upsertUser } from "../src/db/identity";
import { users } from "../src/db/schema";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

const { db } = appDb();
const owner = testDb().db;
const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });
const issuer = "https://idp.test";
const permissionDenied = { cause: { code: "42501" } };
const hour = 60 * 60 * 1000;

async function signIn(sub: string) {
  const user = await upsertUser(db, { issuer, sub, displayName: sub });
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers, body: JSON.stringify(body) });
  return { user, call };
}

async function consentOf(user: string) {
  const [row] = await owner
    .select({ version: users.consentVersion, at: users.consentAt })
    .from(users)
    .where(eq(users.id, user));
  return row;
}

describe("consent to the instance's privacy notice", () => {
  it("is absent for a new account", async () => {
    const { user } = await signIn("consent-new");
    expect(await consentOf(user)).toEqual({ version: null, at: null });
  });

  it("is recorded with the version and the time the device gives", async () => {
    const { user, call } = await signIn("consent-given");
    const at = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect((await call("/api/consent", { version: CONSENT_VERSION, at })).status).toBe(204);
    const row = await consentOf(user);
    expect(row?.version).toBe(CONSENT_VERSION);
    expect(row?.at?.toISOString()).toBe(at);
  });

  it("records the time the device gives, brought within the last day and never past the server's clock", async () => {
    const { user, call } = await signIn("consent-clamped");
    const send = async (offset: number) => {
      const before = Date.now();
      const at = new Date(before + offset).toISOString();
      expect((await call("/api/consent", { version: CONSENT_VERSION, at })).status).toBe(204);
      return { before, after: Date.now(), at, kept: (await consentOf(user))?.at?.getTime() ?? NaN };
    };
    const past = await send(-hour);
    expect(past.kept).toBe(Date.parse(past.at));
    const future = await send(hour);
    expect(future.kept).toBeGreaterThanOrEqual(future.before - 1000);
    expect(future.kept).toBeLessThanOrEqual(future.after + 1000);
    const old = await send(-3 * 24 * hour);
    expect(old.kept).toBeGreaterThanOrEqual(old.before - 24 * hour - 1000);
    expect(old.kept).toBeLessThanOrEqual(old.after - 24 * hour + 1000);
  });

  it("refuses another version with 409 consent_version and records nothing", async () => {
    const { user, call } = await signIn("consent-old");
    const at = new Date().toISOString();
    for (const version of [CONSENT_VERSION - 1, CONSENT_VERSION + 1, "1", null]) {
      const res = await call("/api/consent", { version, at });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "consent_version" });
    }
    expect(await consentOf(user)).toEqual({ version: null, at: null });
  });

  it("refuses a malformed time with 400 invalid and records nothing", async () => {
    const { user, call } = await signIn("consent-malformed");
    for (const at of [undefined, null, "yesterday", "2026-11-20", 1795705855805]) {
      const res = await call("/api/consent", { version: CONSENT_VERSION, at });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid" });
    }
    expect(await consentOf(user)).toEqual({ version: null, at: null });
  });

  it("lets the app role write only the consent columns of its own row", async () => {
    const mine = await upsertUser(db, { issuer, sub: "consent-mine", displayName: "M" });
    const other = await upsertUser(db, { issuer, sub: "consent-other", displayName: "O" });
    const changed = await asUser(db, mine, (tx) =>
      tx
        .update(users)
        .set({ consentVersion: CONSENT_VERSION, consentAt: new Date() })
        .where(eq(users.id, other))
        .returning({ id: users.id }),
    );
    expect(changed).toEqual([]);
    await expect(
      asUser(db, mine, (tx) =>
        tx.update(users).set({ displayName: "renamed" }).where(eq(users.id, mine)),
      ),
    ).rejects.toMatchObject(permissionDenied);
  });

  it("leaves every account of a populated database without consent (migration)", async () => {
    const upTo0008 = mkdtempSync(join(tmpdir(), "belay-0008-"));
    cpSync("drizzle", upTo0008, { recursive: true });
    const journalPath = join(upTo0008, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { idx: number }[] };
    journal.entries = journal.entries.filter((e) => e.idx <= 8);
    writeFileSync(journalPath, JSON.stringify(journal));
    await owner.execute(sql`drop database if exists belay_0009`);
    await owner.execute(sql`create database belay_0009`);
    const url = new URL(inject("databaseUrl"));
    url.pathname = "/belay_0009";
    const fresh = connect(url.href);
    try {
      await runMigrations(fresh.db, upTo0008);
      const ids = [newId(), newId()];
      for (const [i, id] of ids.entries())
        await fresh.db.execute(sql`insert into users (id, oidc_issuer, oidc_sub, display_name)
          values (${id}, ${issuer}, ${`populated-${i}`}, 'P')`);
      await runMigrations(fresh.db, "drizzle");
      const rows = await fresh.db.execute<{ v: number | null; at: Date | null }>(
        sql`select consent_version as v, consent_at as at from users order by id`,
      );
      expect(rows.map((r) => [r.v, r.at])).toEqual([
        [null, null],
        [null, null],
      ]);
    } finally {
      await fresh.client.end();
    }
  });
});
