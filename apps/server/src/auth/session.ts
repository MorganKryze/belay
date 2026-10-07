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

export function setSessionCookie(c: Context, cfg: Config, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: cfg.sessionTtlDays * 86_400,
    ...prefix(cfg),
  });
}

export function readSessionCookie(c: Context, cfg: Config): string | undefined {
  return cfg.secureCookies ? getCookie(c, SESSION_COOKIE, "host") : getCookie(c, SESSION_COOKIE);
}

export function clearSessionCookie(c: Context, cfg: Config) {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: cfg.secureCookies, ...prefix(cfg) });
}

export type AuthEnv = { Variables: { userId: string } };

export function requireUser(cfg: Config, db: Db): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = readSessionCookie(c, cfg);
    const userId = token
      ? await sessionUser(db, hashToken(token, cfg.tokenHashKey), cfg.sessionTtlDays)
      : null;
    if (!token || !userId) {
      if (token) clearSessionCookie(c, cfg);
      return c.json({ error: "unauthenticated" }, 401);
    }
    // The DB expiry slides on every lookup; re-issue the cookie so its Max-Age slides with it.
    setSessionCookie(c, cfg, token);
    c.set("userId", userId);
    await next();
  };
}
