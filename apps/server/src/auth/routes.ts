import { Hono, type Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import * as client from "openid-client";
import { z } from "zod";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { createSession, deleteSession, upsertUser } from "../db/identity";
import { describeError } from "../log";
import { hasRole, pickDisplayName, type OidcProvider } from "./oidc";
import { safeReturnTo } from "./return-to";
import {
  clearSessionCookie,
  hashToken,
  newSessionToken,
  readSessionCookie,
  setSessionCookie,
} from "./session";

// ponytail: one transaction-cookie slot per browser. A second login in another tab overwrites the
// first, and that tab's callback then redirects with `expired`. Upgrade: key the transaction by
// state.
const TX_COOKIE = "belay_oidc";
const txSchema = z.object({
  verifier: z.string(),
  state: z.string(),
  nonce: z.string(),
  returnTo: z.string(),
});

// Signed, so it is ours, but an older version of the app may have written another shape.
function parseTransaction(raw: string) {
  try {
    return txSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

// A failed sign-in never answers an error page: it goes back to the app, which shows a localized
// message and the Sign in link. An installed iOS PWA has no browser chrome to recover from a
// dead end. Keep the reasons in step with `signin.*` in the web i18n files.
type SigninFailure = "unavailable" | "expired" | "failed" | "denied";
const signinFailure = (c: Context, reason: SigninFailure) => c.redirect(`/?signin=${reason}`);

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

  // describeError, not the error: openid-client errors carry cause chains that hold the expected
  // nonce, the ID token claims (e-mail included) and the authorization response.
  auth.onError((err, c) => {
    console.error("auth error:", describeError(err));
    // Logout is a fetch() that expects JSON; everything else here is a browser navigation.
    if (c.req.path === "/auth/logout") return c.json({ error: "server_error" }, 500);
    return signinFailure(c, "failed");
  });

  auth.get("/login", async (c) => {
    let oidc: client.Configuration;
    try {
      oidc = await getOidc();
    } catch (err) {
      console.error("OIDC discovery failed:", describeError(err));
      return signinFailure(c, "unavailable");
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
    const tx = raw ? parseTransaction(raw) : undefined;
    if (!tx) return signinFailure(c, "expired");
    // The provider refused (access_denied, ...): nothing to exchange, and no need to reach it.
    if (c.req.query("error")) return signinFailure(c, "failed");

    // Rebuilt from PUBLIC_URL: behind a reverse proxy the request URL may carry an internal host.
    const incoming = new URL(c.req.url);
    const current = new URL(incoming.pathname + incoming.search, cfg.publicUrl);
    const tokens = await client.authorizationCodeGrant(await getOidc(), current, {
      pkceCodeVerifier: tx.verifier,
      expectedState: tx.state,
      expectedNonce: tx.nonce,
    });
    const claims = tokens.claims();
    if (!claims) throw new Error("the token response carries no ID token claims");

    // Before anything is written, and nothing about the claims is logged.
    const { requiredRole, rolesClaim } = cfg.oidc;
    if (requiredRole && !hasRole(claims, rolesClaim, requiredRole)) {
      return signinFailure(c, "denied");
    }

    const userId = await upsertUser(db, {
      issuer: claims.iss,
      sub: claims.sub,
      displayName: pickDisplayName(claims, cfg.oidc.nameClaim),
    });
    const token = newSessionToken();
    await createSession(db, hashToken(token, cfg.tokenHashKey), userId, cfg.sessionTtlDays);
    setSessionCookie(c, cfg, token);
    // Re-validated: the login side already did it, but the redirect must never rely on that alone.
    return c.redirect(safeReturnTo(tx.returnTo));
  });

  auth.post("/logout", async (c) => {
    const token = readSessionCookie(c, cfg);
    // Cleared first: if the database fails, the browser is still logged out.
    clearSessionCookie(c, cfg);
    if (token) {
      try {
        await deleteSession(db, hashToken(token, cfg.tokenHashKey));
      } catch (err) {
        // The cookie is already gone: the browser is logged out, and the server-side row
        // lapses with the session lifetime.
        console.error("logout: session not deleted:", describeError(err));
      }
    }
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
