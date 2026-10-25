import { inspect } from "node:util";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { CODE_TTL_MS, MAX_PENDING, nativeCodes } from "../src/auth/native";
import { oidcProvider } from "../src/auth/oidc";
import { SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { testEnv } from "./config";
import { appDb, testDb } from "./db";
import { startIdp } from "./idp";

// The app serves as belay_app, as in production; the owner only counts rows.
const { db } = appDb();
const owner = testDb().db;

// RFC 7636 appendix B: the app keeps the verifier and sends only its S256 challenge.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const OTHER_VERIFIER = "A".repeat(43);
const APP_ORIGIN = "capacitor://localhost";

let idp: Awaited<ReturnType<typeof startIdp>>;
let app: Hono;
// The mock signs the tokens at the callback: one listener injects the claims the test asked for.
let nextClaims: Record<string, unknown> = {};

const build = (env: Record<string, string> = {}) => {
  const cfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url!, ...env }));
  return createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });
};

beforeAll(async () => {
  idp = await startIdp();
  idp.service.on("beforeTokenSigning", (token) => {
    Object.assign(token.payload, nextClaims);
  });
  app = build();
});
afterAll(() => idp.stop());
afterEach(() => vi.restoreAllMocks());

const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const location = (res: Response) => res.headers.get("location");
const sessionCookies = (res: Response) =>
  res.headers.getSetCookie().filter((c) => c.startsWith(`${SESSION_COOKIE}=`));

async function start(target: Hono = app, challenge = CHALLENGE) {
  const res = await target.request(`/auth/native/start?challenge=${challenge}`);
  expect(res.status).toBe(302);
  return {
    res,
    authUrl: new URL(location(res)!),
    txCookie: cookiePair(res.headers.get("set-cookie")!),
  };
}

async function idpRedirect(authUrl: URL, claims: Record<string, unknown>) {
  nextClaims = { ...claims, nonce: authUrl.searchParams.get("nonce") };
  const res = await fetch(authUrl, { redirect: "manual" });
  return new URL(res.headers.get("location")!);
}

// Start, the provider, then the callback with the transaction cookie: what the sheet does.
async function signIn(claims: Record<string, unknown>, target: Hono = app) {
  const { authUrl, txCookie } = await start(target);
  const cb = await idpRedirect(authUrl, claims);
  return target.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
}

const codeOf = (res: Response) => {
  const url = new URL(location(res)!);
  expect(`${url.protocol}//${url.host}`).toBe("belay://auth");
  return url.searchParams.get("code")!;
};

const exchange = (body: unknown, target: Hono = app) =>
  target.request("/auth/native/token", {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_ORIGIN },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const counts = async (sub: string) => {
  const users = await owner.execute(sql`select 1 from users where oidc_sub = ${sub}`);
  const sessions = await owner.execute(
    sql`select 1 from sessions s join users u on u.id = s.user_id where u.oidc_sub = ${sub}`,
  );
  return { users: users.length, sessions: sessions.length };
};

const printed = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .flat()
    .map((a) => (typeof a === "string" ? a : inspect(a, { depth: null })))
    .join("\n");

let n = 0;
const sub = () => `native-auth-${++n}-${Math.random().toString(36).slice(2)}`;

describe("GET /auth/native/start", () => {
  it("start redirects to the provider with the web's redirect_uri, its own S256 challenge and an app-marked state", async () => {
    const { authUrl, res } = await start();
    expect(authUrl.origin).toBe(new URL(idp.issuer.url!).origin);
    expect(authUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/callback");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("code_challenge")).toMatch(/^[\w-]{43}$/);
    expect(authUrl.searchParams.get("code_challenge")).not.toBe(CHALLENGE);
    expect(authUrl.searchParams.get("state")).toMatch(/^n\.[\w-]+$/);
    expect(authUrl.searchParams.get("nonce")).toBeTruthy();
    expect(res.headers.get("set-cookie")).toMatch(/^belay_oidc=.*HttpOnly/i);
  });

  it.each([
    ["without", ""],
    ["with a malformed", "?challenge=short"],
    ["with a too long", `?challenge=${"a".repeat(44)}`],
    ["with a non-base64url", `?challenge=${"a".repeat(42)}%2B`],
  ])("start %s challenge goes back to the app with failed, contacting nobody", async (_, query) => {
    const getOidc = vi.fn(() => Promise.reject(new Error("must not be called")));
    const cfg = loadConfig(testEnv({ OIDC_ISSUER: idp.issuer.url! }));
    const target = createApp({ cfg, db, getOidc });
    const res = await target.request(`/auth/native/start${query}`);
    expect(res.status).toBe(302);
    expect(location(res)).toBe("belay://auth?error=failed");
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(getOidc).not.toHaveBeenCalled();
  });

  it("start with the provider down goes back with unavailable", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const down = build({ OIDC_ISSUER: "http://localhost:1" });
    const res = await down.request(`/auth/native/start?challenge=${CHALLENGE}`);
    expect(res.status).toBe(302);
    expect(location(res)).toBe("belay://auth?error=unavailable");
    expect(res.headers.getSetCookie()).toEqual([]);
    for (const arg of spy.mock.calls.flat()) expect(typeof arg).toBe("string");
  });
});

describe("GET /auth/callback for the app", () => {
  it("a full sign-in comes back to belay://auth with a code and sets no session cookie", async () => {
    const who = sub();
    const res = await signIn({ sub: who, name: "Nina" });
    expect(res.status).toBe(302);
    expect(location(res)).toMatch(/^belay:\/\/auth\?code=[\w-]{43}$/);
    expect(sessionCookies(res)).toEqual([]);
    expect(res.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(/^belay_oidc=;.*Max-Age=0/),
    );
    // The person exists; the session waits for the exchange.
    expect(await counts(who)).toEqual({ users: 1, sessions: 0 });
  });

  it("a denied role comes back with denied and stores no one", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const who = sub();
    const res = await signIn(
      { sub: who, groups: ["other"] },
      build({ OIDC_REQUIRED_ROLE: "belay" }),
    );
    expect(location(res)).toBe("belay://auth?error=denied");
    expect(sessionCookies(res)).toEqual([]);
    expect(await counts(who)).toEqual({ users: 0, sessions: 0 });
    expect(printed(spy)).not.toContain(who);
  });

  it("a provider error comes back with failed", async () => {
    const { authUrl, txCookie } = await start();
    const state = authUrl.searchParams.get("state")!;
    const res = await app.request(`/auth/callback?error=access_denied&state=${state}`, {
      headers: { cookie: txCookie },
    });
    expect(location(res)).toBe("belay://auth?error=failed");
  });

  it("a failed exchange with the provider comes back with failed, never to /?signin=", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { authUrl, txCookie } = await start();
    const cb = await idpRedirect(authUrl, { sub: sub() });
    cb.searchParams.set("state", "n.forged");
    const res = await app.request(cb.pathname + cb.search, { headers: { cookie: txCookie } });
    expect(location(res)).toBe("belay://auth?error=failed");
    expect(spy).toHaveBeenCalled();
  });

  it("a lost transaction cookie with an app-marked state comes back with expired, a web state still goes to /?signin=expired", async () => {
    const { authUrl } = await start();
    const cb = await idpRedirect(authUrl, { sub: sub() });
    const lost = await app.request(cb.pathname + cb.search);
    expect(location(lost)).toBe("belay://auth?error=expired");

    const web = await app.request("/auth/login");
    const webCb = await idpRedirect(new URL(location(web)!), { sub: sub() });
    const webLost = await app.request(webCb.pathname + webCb.search);
    expect(location(webLost)).toBe("/?signin=expired");
  });
});

describe("POST /auth/native/token", () => {
  it("the code and its verifier give a token that reads /api/me", async () => {
    const code = codeOf(await signIn({ sub: sub(), name: "Olga" }));
    const res = await exchange({ code, verifier: VERIFIER });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(sessionCookies(res)).toEqual([]);
    const { token } = (await res.json()) as { token: string };
    expect(token).toMatch(/^[\w-]{43}$/);

    const me = await app.request("/api/me", {
      headers: { authorization: `Bearer ${token}`, origin: APP_ORIGIN },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ displayName: "Olga" });
  });

  it("a code works once", async () => {
    const code = codeOf(await signIn({ sub: sub() }));
    expect((await exchange({ code, verifier: VERIFIER })).status).toBe(200);
    const again = await exchange({ code, verifier: VERIFIER });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "invalid_grant" });
  });

  it("a wrong verifier is refused and spends the code", async () => {
    const who = sub();
    const code = codeOf(await signIn({ sub: who }));
    const wrong = await exchange({ code, verifier: OTHER_VERIFIER });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "invalid_grant" });
    const right = await exchange({ code, verifier: VERIFIER });
    expect(right.status).toBe(400);
    expect(await counts(who)).toEqual({ users: 1, sessions: 0 });
  });

  it("a code older than 60 s is refused", async () => {
    const code = codeOf(await signIn({ sub: sub() }));
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + CODE_TTL_MS + 1);
    const res = await exchange({ code, verifier: VERIFIER });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant" });
  });

  it.each([
    ["an unknown code", { code: "x".repeat(43), verifier: VERIFIER }],
    ["no verifier", { code: "x".repeat(43) }],
    ["a short verifier", { code: "x".repeat(43), verifier: "a".repeat(42) }],
    ["a verifier outside base64url", { code: "x".repeat(43), verifier: `${"a".repeat(42)}+` }],
    ["a code too long", { code: "x".repeat(101), verifier: VERIFIER }],
    ["no JSON", "code=x"],
  ])("refuses %s with invalid_grant", async (_, body) => {
    const res = await exchange(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_grant" });
  });

  it("a token body over 4 KB is refused with 413", async () => {
    const res = await exchange({ code: "x".repeat(43), verifier: VERIFIER, pad: "p".repeat(5000) });
    expect(res.status).toBe(413);
  });

  it("the token endpoint answers the app's preflight", async () => {
    const res = await app.request("/auth/native/token", {
      method: "OPTIONS",
      headers: {
        origin: APP_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(APP_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("no code, verifier or token is printed", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    const code = codeOf(await signIn({ sub: sub(), email: "olga@example.test" }));
    await exchange({ code, verifier: OTHER_VERIFIER });
    const code2 = codeOf(await signIn({ sub: sub() }));
    const { token } = (await (await exchange({ code: code2, verifier: VERIFIER })).json()) as {
      token: string;
    };
    const out = spies.map(printed).join("\n");
    for (const secret of [code, code2, VERIFIER, OTHER_VERIFIER, CHALLENGE, token]) {
      expect(out).not.toContain(secret);
    }
    expect(out).not.toContain("olga@example.test");
  });
});

describe("nativeCodes", () => {
  it("issue gives 43 base64url characters", () => {
    const codes = nativeCodes();
    const a = codes.issue("u1", CHALLENGE);
    const b = codes.issue("u1", CHALLENGE);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("redeem compares the challenge of the verifier", () => {
    const codes = nativeCodes();
    expect(codes.redeem(codes.issue("u1", CHALLENGE), VERIFIER)).toBe("u1");
    expect(codes.redeem(codes.issue("u1", CHALLENGE), OTHER_VERIFIER)).toBeNull();
    expect(codes.redeem("unknown", VERIFIER)).toBeNull();
  });

  it("refuses a code at its expiry and keeps it until then", () => {
    const codes = nativeCodes();
    const now = 1_000_000;
    expect(codes.redeem(codes.issue("u1", CHALLENGE, now), VERIFIER, now + CODE_TTL_MS)).toBeNull();
    expect(codes.redeem(codes.issue("u1", CHALLENGE, now), VERIFIER, now + CODE_TTL_MS - 1)).toBe(
      "u1",
    );
  });

  it("the oldest pending code goes past 1 000", () => {
    const codes = nativeCodes();
    const first = codes.issue("first", CHALLENGE);
    const second = codes.issue("second", CHALLENGE);
    for (let i = 2; i < MAX_PENDING; i++) codes.issue(`u${i}`, CHALLENGE);
    codes.issue("last", CHALLENGE);
    expect(codes.redeem(first, VERIFIER)).toBeNull();
    expect(codes.redeem(second, VERIFIER)).toBe("second");
  });
});
