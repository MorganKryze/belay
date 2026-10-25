import { createHmac, randomBytes } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { sessionUser } from "../db/identity";

export const SESSION_COOKIE = "belay_session";

export const newSessionToken = () => randomBytes(32).toString("base64url");
// Keyed with a key derived from SESSION_SECRET (cfg.tokenHashKey): a row written into `sessions`
// by someone who holds only the database never matches a cookie. Changing the secret signs
// everyone out.
export const hashToken = (token: string, key: Buffer) =>
  createHmac("sha256", key).update(token).digest("hex");

// `__Host-` prefix when served over https: the cookie is then bound to this exact origin.
const prefix = (cfg: Config) => (cfg.secureCookies ? ({ prefix: "host" } as const) : {});

// A fresh session gets the full sliding lifetime; a resolved one gets the seconds the database
// says it has left, so the cookie never outlives the absolute cap.
export function setSessionCookie(
  c: Context,
  cfg: Config,
  token: string,
  maxAge = cfg.sessionTtlDays * 86_400,
) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge,
    ...prefix(cfg),
  });
}

export function readSessionCookie(c: Context, cfg: Config): string | undefined {
  return cfg.secureCookies ? getCookie(c, SESSION_COOKIE, "host") : getCookie(c, SESSION_COOKIE);
}

export function clearSessionCookie(c: Context, cfg: Config) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: cfg.secureCookies, ...prefix(cfg) });
}

// The iPhone app's web view runs from this origin; it is the only one CORS answers.
export const NATIVE_ORIGIN = "capacitor://localhost";

// 32 random bytes in base64url, as newSessionToken writes them.
const BEARER = /^Bearer ([A-Za-z0-9_-]{43})$/;

// The header decides when present, so a cookie never rescues a malformed or dead bearer token.
export function requestToken(
  c: Context,
  cfg: Config,
): { token: string | undefined; from: "bearer" | "cookie" } {
  const header = c.req.header("authorization");
  if (header === undefined) return { token: readSessionCookie(c, cfg), from: "cookie" };
  return { token: BEARER.exec(header)?.[1], from: "bearer" };
}

export type AuthEnv = { Variables: { userId: string } };

export function requireUser(cfg: Config, db: Db): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const { token, from } = requestToken(c, cfg);
    const session = token
      ? await sessionUser(
          db,
          hashToken(token, cfg.tokenHashKey),
          cfg.sessionTtlDays,
          cfg.sessionMaxDays,
        )
      : null;
    if (!token || !session) {
      if (token && from === "cookie") clearSessionCookie(c, cfg);
      return c.json({ error: "unauthenticated" }, 401);
    }
    // The DB expiry slides on every lookup, up to the absolute cap; a cookie's Max-Age follows it.
    // The app keeps its bearer token itself, so it gets no cookie.
    if (from === "cookie") setSessionCookie(c, cfg, token, session.maxAge);
    c.set("userId", session.userId);
    await next();
  };
}
