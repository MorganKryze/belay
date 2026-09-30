import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { apiRoutes } from "../src/api/routes";
import {
  clearSessionCookie,
  hashToken,
  newSessionToken,
  readSessionCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from "../src/auth/session";
import { loadConfig } from "../src/config";
import { createSession, upsertUser } from "../src/db/identity";
import { testEnv } from "./config";
import { testDb } from "./db";

const { db } = testDb();
const cfg = loadConfig(testEnv());
const app = new Hono().route("/api", apiRoutes(cfg, db));

async function signedInCookie(sub: string, name: string) {
  const user = await upsertUser(db, { issuer: "https://idp.test", sub, displayName: name });
  const token = newSessionToken();
  await createSession(db, hashToken(token), user, 30);
  return { user, token, cookie: `${SESSION_COOKIE}=${token}` };
}

describe("session tokens", () => {
  it("are long, random, and stored only as a hash", () => {
    const t = newSessionToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSessionToken()).not.toBe(t);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(t)).not.toContain(t);
  });
});

describe("GET /api/me", () => {
  it("returns the signed-in user", async () => {
    const { user, cookie } = await signedInCookie("me-1", "Alex");
    const res = await app.request("/api/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: user, displayName: "Alex" });
  });

  it("scopes the answer to the caller when several users exist", async () => {
    const ada = await signedInCookie("scope-a", "Ada");
    const bo = await signedInCookie("scope-b", "Bo");
    for (const who of [bo, ada, bo]) {
      const res = await app.request("/api/me", { headers: { cookie: who.cookie } });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        id: who.user,
        displayName: who === ada ? "Ada" : "Bo",
      });
    }
  });

  it("re-issues the session cookie so its lifetime slides with the session", async () => {
    const { token, cookie } = await signedInCookie("slide-1", "Kim");
    const res = await app.request("/api/me", { headers: { cookie } });
    expect(res.status).toBe(200);
    const header = res.headers.getSetCookie().find((h) => h.startsWith(`${SESSION_COOKIE}=`));
    expect(header).toBeDefined();
    expect(header).toContain(`${SESSION_COOKIE}=${token};`);
    expect(header).toContain(`Max-Age=${cfg.sessionTtlDays * 86_400}`);
    expect(header).toContain("HttpOnly");
  });

  it("answers 401 without a cookie", async () => {
    expect((await app.request("/api/me")).status).toBe(401);
  });

  it("answers 401 and clears the cookie for an expired session", async () => {
    const { token, cookie } = await signedInCookie("me-2", "Sam");
    await db.execute(
      sql`update sessions set expires_at = now() - interval '1 second' where token_hash = ${hashToken(token)}`,
    );
    const res = await app.request("/api/me", { headers: { cookie } });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`));
  });
});

describe("session cookie flags", () => {
  const cookieApp = (secure: boolean) => {
    const c = loadConfig(testEnv(secure ? { PUBLIC_URL: "https://belay.example" } : {}));
    return new Hono()
      .get("/set", (ctx) => (setSessionCookie(ctx, c, "tok"), ctx.text("ok")))
      .get("/clear", (ctx) => (clearSessionCookie(ctx, c), ctx.text("ok")))
      .get("/read", (ctx) => ctx.text(readSessionCookie(ctx, c) ?? "none"));
  };

  it("is httpOnly, Lax and unprefixed over http", async () => {
    const res = await cookieApp(false).request("/set");
    const header = res.headers.getSetCookie()[0]!;
    expect(header).toMatch(new RegExp(`^${SESSION_COOKIE}=tok;`));
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain(`Max-Age=${cfg.sessionTtlDays * 86_400}`);
    expect(header).not.toContain("Secure");
  });

  it("gets the __Host- prefix and Secure over https", async () => {
    const app = cookieApp(true);
    const header = (await app.request("/set")).headers.getSetCookie()[0]!;
    expect(header).toMatch(new RegExp(`^__Host-${SESSION_COOKIE}=tok;`));
    expect(header).toContain("HttpOnly");
    expect(header).toContain("Secure");
    expect(header).toContain("Path=/");
    expect(header).not.toContain("Domain");

    const read = (cookie: string) => app.request("/read", { headers: { cookie } });
    expect(await (await read(`__Host-${SESSION_COOKIE}=tok`)).text()).toBe("tok");
    expect(await (await read(`${SESSION_COOKIE}=tok`)).text()).toBe("none");

    const cleared = (await app.request("/clear")).headers.getSetCookie()[0]!;
    expect(cleared).toMatch(new RegExp(`^__Host-${SESSION_COOKIE}=;.*Max-Age=0`));
  });
});
