import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiRoutes } from "../src/api/routes";
import { oidcProvider } from "../src/auth/oidc";
import { authRoutes } from "../src/auth/routes";
import { SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { testEnv } from "./config";
import { testDb } from "./db";
import { startIdp } from "./idp";

const { db } = testDb();
let idp: Awaited<ReturnType<typeof startIdp>>;
let app: Hono;
// The mock signs both the access token and the ID token, and signing happens at
// the callback, not at /authorize: one persistent listener injects the claims
// the current test asked for into every token.
let nextClaims: Record<string, unknown> = {};

beforeAll(async () => {
  idp = await startIdp();
  idp.service.on("beforeTokenSigning", (token) => {
    Object.assign(token.payload, nextClaims);
  });
  const cfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url! }));
  app = new Hono()
    .route("/auth", authRoutes(cfg, db, oidcProvider(cfg.oidc)))
    .route("/api", apiRoutes(cfg, db));
});
afterAll(() => idp.stop());

const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

async function startLogin(returnTo: string) {
  const res = await app.request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  expect(res.status).toBe(302);
  const authUrl = new URL(res.headers.get("location")!);
  return { authUrl, txCookie: cookiePair(res.headers.get("set-cookie")!) };
}

async function idpRedirect(authUrl: URL, claims: Record<string, string>) {
  nextClaims = { ...claims, nonce: authUrl.searchParams.get("nonce") };
  const res = await fetch(authUrl, { redirect: "manual" });
  return new URL(res.headers.get("location")!);
}

describe("OIDC login", () => {
  it("uses PKCE S256, state and nonce", async () => {
    const { authUrl } = await startLogin("/");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("code_challenge")).toBeTruthy();
    expect(authUrl.searchParams.get("state")).toBeTruthy();
    expect(authUrl.searchParams.get("nonce")).toBeTruthy();
    expect(authUrl.searchParams.get("scope")).toBe("openid profile");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
  });

  it("signs in, redirects to returnTo, and stores no e-mail", async () => {
    const { authUrl, txCookie } = await startLogin("/settings");
    const cb = await idpRedirect(authUrl, {
      sub: "alice-sub",
      name: "Alice",
      email: "alice@example.test",
    });
    const res = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/settings");

    const session = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);

    const me = await app.request("/api/me", { headers: { cookie: cookiePair(session) } });
    expect(await me.json()).toMatchObject({ displayName: "Alice" });

    const rows = await db.execute(sql`select * from users where oidc_sub = 'alice-sub'`);
    expect(JSON.stringify(rows)).not.toContain("alice@example.test");
  });

  it("refuses a callback without the login transaction cookie", async () => {
    const { authUrl } = await startLogin("/");
    const cb = await idpRedirect(authUrl, { sub: "no-cookie" });
    const res = await app.request(cb.pathname + cb.search);
    expect(res.status).toBe(400);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it("refuses a callback whose state was tampered with", async () => {
    const { authUrl, txCookie } = await startLogin("/");
    const cb = await idpRedirect(authUrl, { sub: "tampered" });
    cb.searchParams.set("state", "forged");
    const res = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expect(res.status).toBe(400);
  });

  it("never redirects off-site after login", async () => {
    const { authUrl, txCookie } = await startLogin("//evil.example");
    const cb = await idpRedirect(authUrl, { sub: "redirect" });
    const res = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expect(res.headers.get("location")).toBe("/");
  });

  it("logs out: the session stops working and the IdP logout URL is returned", async () => {
    const { authUrl, txCookie } = await startLogin("/");
    const cb = await idpRedirect(authUrl, { sub: "bye" });
    const login = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    const session = cookiePair(
      login.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!,
    );

    const out = await app.request("/auth/logout", { method: "POST", headers: { cookie: session } });
    expect(out.status).toBe(200);
    const { redirectTo } = (await out.json()) as { redirectTo: string };
    expect(redirectTo.startsWith(idp.issuer.url!)).toBe(true);

    const me = await app.request("/api/me", { headers: { cookie: session } });
    expect(me.status).toBe(401);
  });
});

describe("identity provider down", () => {
  it("answers 503 with a readable message", async () => {
    const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
    const down = new Hono().route("/auth", authRoutes(cfg, db, oidcProvider(cfg.oidc)));
    const res = await down.request("/auth/login");
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/identity provider/i);
  });
});
