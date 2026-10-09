import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { serializeSigned } from "hono/utils/cookie";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { apiRoutes } from "../src/api/routes";
import { oidcProvider } from "../src/auth/oidc";
import { authRoutes } from "../src/auth/routes";
import { SESSION_COOKIE } from "../src/auth/session";
import { loadConfig, type Config } from "../src/config";
import type { Db } from "../src/db/client";
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
// The last request the server sent to the token endpoint. The mock only checks PKCE when a
// code_verifier is sent and never checks redirect_uri, so the tests assert on both here.
let lastTokenRequest: Record<string, unknown> = {};

beforeAll(async () => {
  idp = await startIdp();
  idp.service.on("beforeTokenSigning", (token, req) => {
    Object.assign(token.payload, nextClaims);
    lastTokenRequest = { ...req.body };
  });
  const cfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url! }));
  app = new Hono()
    .route("/auth", authRoutes(cfg, db, oidcProvider(cfg.oidc)))
    .route("/api", apiRoutes(cfg, db));
});
afterAll(() => idp.stop());
afterEach(() => vi.restoreAllMocks());

const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;

async function startLogin(returnTo: string, target: Hono = app) {
  const res = await target.request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  expect(res.status).toBe(302);
  const authUrl = new URL(res.headers.get("location")!);
  return { authUrl, res, txCookie: cookiePair(res.headers.get("set-cookie")!) };
}

// What is printed to the console, as Node would render it (errors expanded with their causes).
const printed = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .flat()
    .map((a) => (typeof a === "string" ? a : inspect(a, { depth: null })))
    .join("\n");

const setCookies = (res: Response) => res.headers.getSetCookie();
const startsWithSession = (c: string) => c.startsWith(`${SESSION_COOKIE}=`);

// A failed sign-in never answers an error page: it sends the browser back to the app, which
// shows a localized message (an installed iOS PWA has no browser chrome to recover from a dead end).
function expectSigninRedirect(res: Response, reason: string) {
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe(`/?signin=${reason}`);
  expect(setCookies(res).some(startsWithSession)).toBe(false);
}
const expectTxCookieCleared = (res: Response, name = "belay_oidc") =>
  expect(setCookies(res)).toContainEqual(
    expect.stringMatching(new RegExp(`^${name}=;.*Max-Age=0`)),
  );

async function idpRedirect(authUrl: URL, claims: Record<string, unknown>) {
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

    // PKCE verifier and the PUBLIC_URL-based redirect_uri reach the token endpoint.
    expect(lastTokenRequest.code_verifier).toEqual(expect.stringMatching(/^[\w-]{43,}$/));
    expect(lastTokenRequest.redirect_uri).toBe("http://localhost:3000/auth/callback");
    // The transaction is single-use: the callback clears its cookie.
    expect(res.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^belay_oidc=;.*Max-Age=0/),
    );

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
    expectSigninRedirect(res, "expired");
    expectTxCookieCleared(res);
  });

  it("refuses a callback whose state was tampered with", async () => {
    const { authUrl, txCookie } = await startLogin("/");
    const cb = await idpRedirect(authUrl, { sub: "tampered" });
    cb.searchParams.set("state", "forged");
    const res = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expectSigninRedirect(res, "failed");
    expectTxCookieCleared(res);
  });

  it("refuses a transaction cookie that is not signed by the server", async () => {
    const { authUrl, txCookie } = await startLogin("/");
    const cb = await idpRedirect(authUrl, { sub: "forged-cookie" });
    // Well-formed and consistent with the real login, but unsigned or badly signed.
    const [name, value] = [txCookie.split("=")[0]!, decodeURIComponent(txCookie.split("=")[1]!)];
    const payload = value.match(/^\{.*\}/)![0]; // the JSON, with or without a signature
    const unsigned = `${name}=${encodeURIComponent(payload)}`;
    const badSignature = `${name}=${encodeURIComponent(`${payload}.${"A".repeat(43)}=`)}`;
    for (const cookie of [unsigned, badSignature]) {
      const res = await app.request(cb.pathname + cb.search, { headers: { cookie } });
      expectSigninRedirect(res, "expired");
      expectTxCookieCleared(res);
    }
  });

  it("treats a validly signed but unparsable transaction as expired", async () => {
    const { authUrl } = await startLogin("/");
    const cb = await idpRedirect(authUrl, { sub: "garbage-tx" });
    for (const payload of ["not json", "{}", JSON.stringify({ verifier: 1 })]) {
      const signed = await serializeSigned("belay_oidc", payload, "x".repeat(32));
      const res = await app.request(cb.pathname + cb.search, {
        headers: { cookie: cookiePair(signed) },
      });
      expectSigninRedirect(res, "expired");
      expectTxCookieCleared(res);
    }
  });

  it("sends an identity provider error (access_denied) back to the app as failed", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { authUrl, txCookie } = await startLogin("/");
    const state = authUrl.searchParams.get("state")!;
    const res = await app.request(`/auth/callback?error=access_denied&state=${state}`, {
      headers: { cookie: txCookie },
    });
    expectSigninRedirect(res, "failed");
    expectTxCookieCleared(res);
    expect(printed(spy)).not.toContain(state);
  });

  it("sends a failed database write back to the app as failed, without a session", async () => {
    const cfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url! }));
    const brokenDb = new Proxy(
      {},
      {
        get() {
          throw new Error("db down");
        },
      },
    ) as Db;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new Hono().route("/auth", authRoutes(cfg, brokenDb, oidcProvider(cfg.oidc)));
    const { authUrl, txCookie } = await startLogin("/", broken);
    const cb = await idpRedirect(authUrl, { sub: "db-down" });
    const res = await broken.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expectSigninRedirect(res, "failed");
    expectTxCookieCleared(res);
    expect(printed(spy)).toContain("db down");
  });

  it("logs a failed callback without the error object, its cause chain or any claim", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { authUrl, txCookie } = await startLogin("/");
    // A wrong nonce makes openid-client throw an error whose cause holds the expected nonce
    // and every claim of the ID token, e-mail included.
    nextClaims = { sub: "log-1", email: "leak@example.test", nonce: "wrong" };
    const idpRes = await fetch(authUrl, { redirect: "manual" });
    const cb = new URL(idpRes.headers.get("location")!);
    const res = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expectSigninRedirect(res, "failed");

    expect(spy).toHaveBeenCalled();
    for (const arg of spy.mock.calls.flat()) expect(typeof arg).toBe("string");
    const out = printed(spy);
    expect(out).toContain("ClientError");
    expect(out).toContain("OAUTH_JWT_CLAIM_COMPARISON_FAILED");
    expect(out).not.toContain("leak@example.test");
    expect(out).not.toContain(authUrl.searchParams.get("nonce")!);
    expect(out).not.toContain(cb.searchParams.get("code")!);
  });

  it("never redirects off-site after login", async () => {
    const { authUrl, txCookie } = await startLogin("//evil.example");
    const cb = await idpRedirect(authUrl, { sub: "redirect" });
    const res = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expect(res.headers.get("location")).toBe("/");
  });

  it("re-validates returnTo at the callback even when the cookie carries a hostile one", async () => {
    const { authUrl, txCookie } = await startLogin("/");
    // A validly signed transaction whose returnTo bypassed the login-side check.
    const tx = JSON.parse(decodeURIComponent(txCookie.split("=")[1]!).replace(/\.[^.]+$/, ""));
    const signed = await serializeSigned(
      "belay_oidc",
      JSON.stringify({ ...tx, returnTo: "//evil.example" }),
      "x".repeat(32),
    );
    const cb = await idpRedirect(authUrl, { sub: "hostile-return" });
    const res = await app.request(cb.pathname + cb.search, {
      headers: { cookie: cookiePair(signed) },
    });
    expect(res.status).toBe(302);
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

describe("logout when the database fails", () => {
  it("still clears the session cookie and returns the redirect", async () => {
    const cfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url! }));
    const brokenDb = new Proxy(
      {},
      {
        get() {
          throw new Error("db down");
        },
      },
    ) as Db;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = new Hono().route("/auth", authRoutes(cfg, brokenDb, oidcProvider(cfg.oidc)));
    const res = await broken.request("/auth/logout", {
      method: "POST",
      headers: { cookie: `${SESSION_COOKIE}=some-session-token` },
    });
    expect(res.status).toBe(200);
    const { redirectTo } = (await res.json()) as { redirectTo: string };
    expect(redirectTo.startsWith(idp.issuer.url!)).toBe(true);
    expectTxCookieCleared(res, SESSION_COOKIE);
    // Logged as text (name and message), like every other auth failure.
    expect(printed(spy)).toContain("db down");
    for (const arg of spy.mock.calls.flat()) expect(typeof arg).toBe("string");
  });

  it("answers JSON, not a redirect, when logout fails for any other reason", async () => {
    let armed = false;
    const cfg = {
      ...loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url! })),
      get secureCookies(): boolean {
        if (armed) throw new Error("boom");
        return false;
      },
    } as Config;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const app = new Hono().route("/auth", authRoutes(cfg, db, oidcProvider(cfg.oidc)));
    armed = true;
    const res = await app.request("/auth/logout", { method: "POST" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
});

describe("over https", () => {
  let cfg: Config;
  let secure: Hono;
  beforeAll(() => {
    cfg = loadConfig(
      testEnv({ OIDC_ISSUER: idp.issuer.url!, PUBLIC_URL: "https://belay.example" }),
    );
    secure = new Hono().route("/auth", authRoutes(cfg, db, oidcProvider(cfg.oidc)));
  });

  it("binds the login transaction cookie to this origin with the __Host- prefix", async () => {
    const { res } = await startLogin("/", secure);
    const header = res.headers.getSetCookie()[0]!;
    expect(header).toMatch(/^__Host-belay_oidc=/);
    expect(header).toContain("; Secure");
    expect(header).toContain("; Path=/");
    expect(header).toContain("; HttpOnly");
    expect(header).toContain("; SameSite=Lax");
    expect(header).toContain("; Max-Age=600");
    expect(header).not.toMatch(/Domain=/i);
  });

  it("reads and clears the prefixed cookie at the callback", async () => {
    const { authUrl, txCookie } = await startLogin("/next", secure);
    expect(authUrl.searchParams.get("redirect_uri")).toBe("https://belay.example/auth/callback");
    const cb = await idpRedirect(authUrl, { sub: "https-user", name: "Hattie" });
    const res = await secure.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/next");
    expect(res.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^__Host-belay_oidc=;.*Max-Age=0.*Secure/),
    );
    expect(res.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(new RegExp(`^__Host-${SESSION_COOKIE}=`)),
    );
    expect(lastTokenRequest.redirect_uri).toBe("https://belay.example/auth/callback");
  });

  it("ignores a plain-named transaction cookie", async () => {
    const { authUrl, txCookie } = await startLogin("/", secure);
    const cb = await idpRedirect(authUrl, { sub: "https-plain" });
    const plain = txCookie.replace(/^__Host-/, "");
    const res = await secure.request(cb.pathname + cb.search, { headers: { cookie: plain } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?signin=expired");
  });
});

describe("required role", () => {
  const roleApp = (env: Record<string, string>) => {
    const cfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url!, ...env }));
    return new Hono()
      .route("/auth", authRoutes(cfg, db, oidcProvider(cfg.oidc)))
      .route("/api", apiRoutes(cfg, db));
  };
  const counts = async (sub: string) => {
    const users = await db.execute(sql`select 1 from users where oidc_sub = ${sub}`);
    const sessions = await db.execute(
      sql`select 1 from sessions s join users u on u.id = s.user_id where u.oidc_sub = ${sub}`,
    );
    return { users: users.length, sessions: sessions.length };
  };
  async function signIn(target: Hono, claims: Record<string, unknown>) {
    const { authUrl, txCookie } = await startLogin("/", target);
    const cb = await idpRedirect(authUrl, claims);
    return target.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
  }

  it("signs in someone who has the role, in the configured claim", async () => {
    const gated = roleApp({
      OIDC_REQUIRED_ROLE: "belay-user",
      OIDC_ROLES_CLAIM: "resource_access.belay.roles",
    });
    const res = await signIn(gated, {
      sub: "role-ok",
      name: "Rita",
      resource_access: { belay: { roles: ["other", "belay-user"] } },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(setCookies(res).some(startsWithSession)).toBe(true);
    expect(await counts("role-ok")).toEqual({ users: 1, sessions: 1 });
  });

  it("reads `groups` by default", async () => {
    const res = await signIn(roleApp({ OIDC_REQUIRED_ROLE: "belay" }), {
      sub: "role-groups",
      groups: ["belay"],
    });
    expect(res.headers.get("location")).toBe("/");
  });

  it.each([
    ["lacks the role", { groups: ["other"] }],
    ["has no such claim", {}],
    ["has a claim of the wrong type", { groups: { belay: true } }],
  ])("denies someone who %s: no user, no session, no cookie", async (_, extra) => {
    const sub = `role-denied-${Math.random().toString(36).slice(2)}`;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await signIn(roleApp({ OIDC_REQUIRED_ROLE: "belay" }), { sub, ...extra });
    expectSigninRedirect(res, "denied");
    expectTxCookieCleared(res);
    expect(await counts(sub)).toEqual({ users: 0, sessions: 0 });
    expect(printed(spy)).not.toContain(sub);
  });

  it("changes nothing when no role is required", async () => {
    const res = await signIn(roleApp({}), { sub: "role-unset", groups: [] });
    expect(res.headers.get("location")).toBe("/");
    expect(await counts("role-unset")).toEqual({ users: 1, sessions: 1 });
  });
});

describe("identity provider down", () => {
  it("sends the browser back to the app, which explains it", async () => {
    const cfg = loadConfig(testEnv({ OIDC_ISSUER: "http://localhost:1" }));
    const down = new Hono().route("/auth", authRoutes(cfg, db, oidcProvider(cfg.oidc)));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await down.request("/auth/login");
    expectSigninRedirect(res, "unavailable");
    expect(setCookies(res)).toEqual([]); // no transaction was started
    // Logged as text (name and message), not as an error object with its cause chain.
    expect(spy).toHaveBeenCalled();
    for (const arg of spy.mock.calls.flat()) expect(typeof arg).toBe("string");
  });
});
