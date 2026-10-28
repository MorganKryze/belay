import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { createSession, upsertUser } from "../src/db/identity";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";

// The app serves as belay_app, as in production; the owner only arranges and reads session rows.
const { db } = appDb();
const owner = testDb().db;

const dist = mkdtempSync(join(tmpdir(), "belay-web-"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>Belay</title>");
const media = mkdtempSync(join(tmpdir(), "belay-media-"));
const loop = Buffer.from(Array.from({ length: 200 }, (_, i) => i % 251));
writeFileSync(join(media, "0001.mp4"), loop);

const cfg = loadConfig(
  testEnv({
    OIDC_ISSUER: "http://localhost:1",
    WEB_DIST: relative(process.cwd(), dist),
    BELAY_MEDIA_DIR: media,
  }),
);
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });

const APP_ORIGIN = "capacitor://localhost";
const OTHER_ORIGIN = "https://evil.example";

let n = 0;
async function signIn() {
  const sub = `native-${++n}`;
  const user = await upsertUser(db, { issuer: "https://idp.test", sub, displayName: sub });
  const token = newSessionToken();
  await createSession(db, hashToken(token, cfg.tokenHashKey), user, cfg.sessionTtlDays);
  return { user, token, bearer: `Bearer ${token}`, cookie: `${SESSION_COOKIE}=${token}` };
}

const expiresAt = async (token: string) => {
  const rows = await owner.execute<{ expires_at: string }>(
    sql`select expires_at::text from sessions where token_hash = ${hashToken(token, cfg.tokenHashKey)}`,
  );
  return rows[0] ? new Date(rows[0].expires_at) : undefined;
};

const me = (headers: Record<string, string>) => app.request("/api/me", { headers });

describe("GET /api/instance", () => {
  const probe = { app: "belay", api: 1, origin: "http://localhost:3000" };

  it("the probe answers a stranger with the app's name, api 1 and PUBLIC_URL's origin, no-store", async () => {
    const res = await app.request("/api/instance");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(probe);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("the probe says the same with a session", async () => {
    const { bearer, cookie } = await signIn();
    for (const headers of [{ authorization: bearer }, { cookie }] as Record<string, string>[]) {
      const res = await app.request("/api/instance", { headers });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(probe);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });
});

describe("CORS for the app", () => {
  it("the app's origin gets Access-Control-Allow-Origin and Vary on /api, /media, /auth/native and /auth/logout, never Allow-Credentials", async () => {
    const { bearer } = await signIn();
    const headers = { origin: APP_ORIGIN, authorization: bearer };
    const answers = [
      await app.request("/api/instance", { headers: { origin: APP_ORIGIN } }),
      await app.request("/api/me", { headers }),
      await app.request("/media/exercises/0001", { headers }),
      await app.request("/auth/native/token", { headers }),
      await app.request("/auth/logout", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: "{}",
      }),
    ];
    for (const res of answers) {
      expect(res.headers.get("access-control-allow-origin"), res.url).toBe(APP_ORIGIN);
      expect(res.headers.get("vary"), res.url).toContain("Origin");
      expect(res.headers.get("access-control-allow-credentials"), res.url).toBeNull();
    }
  });

  it("the app's origin gets no CORS header outside those paths", async () => {
    for (const path of ["/", "/healthz", "/auth/login-nope", "/settings"]) {
      const res = await app.request(path, { headers: { origin: APP_ORIGIN } });
      expect(res.headers.get("access-control-allow-origin"), path).toBeNull();
    }
  });

  it("a preflight from the app's origin allows GET, HEAD, POST, Authorization and Content-Type for 600 s", async () => {
    const res = await app.request("/api/sync", {
      method: "OPTIONS",
      headers: {
        origin: APP_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("GET,HEAD,POST");
    expect(res.headers.get("access-control-allow-headers")).toBe("Authorization,Content-Type");
    expect(res.headers.get("access-control-max-age")).toBe("600");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("the Android app's origin gets the same answer, and a near miss gets none", async () => {
    const { bearer } = await signIn();
    const android = await me({ origin: "https://localhost", authorization: bearer });
    expect(android.headers.get("access-control-allow-origin")).toBe("https://localhost");
    for (const origin of [
      "http://localhost",
      "https://localhost:8443",
      "https://localhost.evil.example",
    ]) {
      const res = await me({ origin, authorization: bearer });
      expect(res.headers.get("access-control-allow-origin"), origin).toBeNull();
    }
  });

  it("another origin gets no CORS header, on a request or a preflight", async () => {
    const { bearer } = await signIn();
    const request = await me({ origin: OTHER_ORIGIN, authorization: bearer });
    const preflight = await app.request("/api/me", {
      method: "OPTIONS",
      headers: {
        origin: OTHER_ORIGIN,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    for (const res of [request, preflight]) {
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    }
  });
});

describe("bearer sessions", () => {
  it("a live bearer token reads /api/me with no cookie set", async () => {
    const { user, bearer } = await signIn();
    const res = await me({ authorization: bearer });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { id: string }).id).toBe(user);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("a bearer request slides the session's expiry", async () => {
    const { token, bearer } = await signIn();
    await owner.execute(
      sql`update sessions set expires_at = now() + interval '1 day' where token_hash = ${hashToken(token, cfg.tokenHashKey)}`,
    );
    const before = (await expiresAt(token))!;
    const res = await me({ authorization: bearer });
    expect(res.status).toBe(200);
    const after = (await expiresAt(token))!;
    expect(after.getTime() - before.getTime()).toBeGreaterThan(
      (cfg.sessionTtlDays - 2) * 86_400_000,
    );
  });

  it("a malformed Bearer header is a 401 even with a valid cookie", async () => {
    const { token, cookie } = await signIn();
    for (const authorization of [
      "Bearer",
      `Bearer ${token}x`,
      `Bearer ${token.slice(1)}`,
      `Bearer ${token.slice(1)}=`,
      `Bearer  ${token}`,
    ]) {
      const res = await me({ authorization, cookie });
      expect(res.status, authorization).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
      expect(res.headers.getSetCookie(), authorization).toEqual([]);
    }
    // The cookie's session was neither used nor ended.
    expect((await me({ cookie })).status).toBe(200);
  });

  it("another scheme, as a proxy's Basic auth sends, leaves the cookie in charge, logout included", async () => {
    const { token, cookie } = await signIn();
    for (const authorization of ["", "Basic dXNlcjpwYXNz", `Basic ${token}`]) {
      expect((await me({ authorization, cookie })).status, authorization).toBe(200);
    }
    const out = await app.request("/auth/logout", {
      method: "POST",
      headers: { authorization: "Basic dXNlcjpwYXNz", cookie, "content-type": "application/json" },
    });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie().join()).toMatch(/Max-Age=0/i);
    expect((await me({ cookie })).status).toBe(401);
  });

  it("the Bearer scheme is read whatever its case", async () => {
    const { token } = await signIn();
    expect((await me({ authorization: `bearer ${token}` })).status).toBe(200);
  });

  it("a dead or unknown bearer token is a 401 even with a valid cookie", async () => {
    const { cookie } = await signIn();
    const dead = await signIn();
    await owner.execute(
      sql`update sessions set expires_at = now() - interval '1 second' where token_hash = ${hashToken(dead.token, cfg.tokenHashKey)}`,
    );
    for (const authorization of [dead.bearer, `Bearer ${newSessionToken()}`]) {
      const res = await me({ authorization, cookie });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthenticated" });
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("a cookie alone works as before", async () => {
    const { token, cookie } = await signIn();
    const res = await me({ cookie });
    expect(res.status).toBe(200);
    const header = res.headers.getSetCookie().find((h) => h.startsWith(`${SESSION_COOKIE}=`));
    expect(header).toContain(`${SESSION_COOKIE}=${token};`);
    expect(header).toContain(`Max-Age=${cfg.sessionTtlDays * 86_400}`);
  });

  it("/api/sync accepts a bearer session and still refuses another account's queue", async () => {
    const a = await signIn();
    const b = await signIn();
    const sync = (bearer: string, account: string) =>
      app.request("/api/sync", {
        method: "POST",
        headers: { origin: APP_ORIGIN, authorization: bearer, "content-type": "application/json" },
        body: JSON.stringify({ account, cursor: "0", changes: [] }),
      });
    const own = await sync(a.bearer, a.user);
    expect(own.status).toBe(200);
    expect(own.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect((await sync(b.bearer, a.user)).status).toBe(409);
  });

  it("a loop is served to a bearer session with the CORS header", async () => {
    const { bearer } = await signIn();
    const res = await app.request("/media/exercises/0001", {
      headers: { origin: APP_ORIGIN, authorization: bearer },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(loop);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("POST /auth/logout from the app", () => {
  it("logout with a bearer token as JSON from the app's origin ends that session and sets no cookie", async () => {
    const { bearer } = await signIn();
    const browser = await signIn();
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        origin: APP_ORIGIN,
        authorization: bearer,
        cookie: browser.cookie,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirectTo: cfg.publicUrl.href });
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect((await me({ authorization: bearer })).status).toBe(401);
    // The header decides: a cookie sent alongside is neither cleared nor ended.
    expect((await me({ cookie: browser.cookie })).status).toBe(200);
  });

  it("logout with a bearer token and no content type from the app's origin is refused by the cross-site guard", async () => {
    const { bearer } = await signIn();
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: { origin: APP_ORIGIN, authorization: bearer },
    });
    expect(res.status).toBe(403);
    expect((await me({ authorization: bearer })).status).toBe(200);
  });
});
