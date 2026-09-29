import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import * as client from "openid-client";
import { z } from "zod";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { createSession, deleteSession, upsertUser } from "../db/identity";
import { pickDisplayName, type OidcProvider } from "./oidc";
import { safeReturnTo } from "./return-to";
import {
  clearSessionCookie,
  hashToken,
  newSessionToken,
  readSessionCookie,
  setSessionCookie,
} from "./session";

const TX_COOKIE = "belay_oidc";
const txSchema = z.object({
  verifier: z.string(),
  state: z.string(),
  nonce: z.string(),
  returnTo: z.string(),
});

// Name, message and code only: openid-client errors carry cause chains that hold the expected
// nonce, the ID token claims (e-mail included) and the authorization response.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return "unknown error";
  const code = (err as { code?: unknown }).code;
  const suffix = typeof code === "string" || typeof code === "number" ? ` (code ${code})` : "";
  return `${err.name}: ${err.message}${suffix}`;
}

export function authRoutes(cfg: Config, db: Db, getOidc: OidcProvider) {
  const auth = new Hono();
  const redirectUri = new URL("/auth/callback", cfg.publicUrl).href;
  // `__Host-` over https (Secure, Path=/, no Domain): a sibling subdomain cannot plant a
  // transaction cookie of its own, which would allow login CSRF.
  const txCookieOpts = {
    httpOnly: true,
    secure: cfg.secureCookies,
    sameSite: "Lax" as const,
    path: "/",
    ...(cfg.secureCookies ? { prefix: "host" as const } : {}),
  };

  auth.onError((err, c) => {
    console.error("auth error:", describeError(err));
    return c.text("Sign-in failed. Please try again.", 400);
  });

  auth.get("/login", async (c) => {
    let oidc: client.Configuration;
    try {
      oidc = await getOidc();
    } catch (err) {
      console.error("OIDC discovery failed:", describeError(err));
      return c.text("The identity provider is unreachable. Please try again in a moment.", 503);
    }
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const returnTo = safeReturnTo(c.req.query("returnTo"));
    await setSignedCookie(
      c,
      TX_COOKIE,
      JSON.stringify({ verifier, state, nonce, returnTo }),
      cfg.sessionSecret,
      { ...txCookieOpts, maxAge: 600 },
    );
    const url = client.buildAuthorizationUrl(oidc, {
      redirect_uri: redirectUri,
      scope: "openid profile",
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    return c.redirect(url.href);
  });

  auth.get("/callback", async (c) => {
    const raw = await getSignedCookie(c, cfg.sessionSecret, TX_COOKIE, txCookieOpts.prefix);
    deleteCookie(c, TX_COOKIE, txCookieOpts);
    if (!raw) return c.text("Your sign-in expired. Please start again.", 400);
    const tx = txSchema.parse(JSON.parse(raw));

    // Rebuilt from PUBLIC_URL: behind a reverse proxy the request URL may carry an internal host.
    const incoming = new URL(c.req.url);
    const current = new URL(incoming.pathname + incoming.search, cfg.publicUrl);
    const tokens = await client.authorizationCodeGrant(await getOidc(), current, {
      pkceCodeVerifier: tx.verifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
    });
    const claims = tokens.claims();
    if (!claims) return c.text("Sign-in failed: no identity returned.", 400);

    const userId = await upsertUser(db, {
      issuer: claims.iss,
      sub: claims.sub,
      displayName: pickDisplayName(claims, cfg.oidc.nameClaim),
    });
    const token = newSessionToken();
    await createSession(db, hashToken(token), userId, cfg.sessionTtlDays);
    setSessionCookie(c, cfg, token);
    // Re-validated: the login side already did it, but the redirect must never rely on that alone.
    return c.redirect(safeReturnTo(tx.returnTo));
  });

  auth.post("/logout", async (c) => {
    const token = readSessionCookie(c, cfg);
    // Cleared first: if the database fails, the browser is still logged out.
    clearSessionCookie(c, cfg);
    if (token) await deleteSession(db, hashToken(token));
    let redirectTo = cfg.publicUrl.href;
    try {
      const oidc = await getOidc();
      if (oidc.serverMetadata().end_session_endpoint) {
        redirectTo = client.buildEndSessionUrl(oidc, {
          post_logout_redirect_uri: cfg.publicUrl.href,
        }).href;
      }
    } catch {
      // IdP unreachable: the local session is gone, which is what matters.
    }
    return c.json({ redirectTo });
  });

  return auth;
}
