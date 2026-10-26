import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import * as client from "openid-client";
import { z } from "zod";
import type { Config } from "../config";
import type { Db } from "../db/client";
import { createSession, deleteSession, upsertUser } from "../db/identity";
import { describeError } from "../log";
import {
  CHALLENGE,
  loggedInSince,
  NATIVE_STATE,
  nativeCallback,
  nativeCodes,
  type SigninFailure,
} from "./native";
import { hasRole, pickDisplayName, type OidcProvider } from "./oidc";
import { safeReturnTo } from "./return-to";
import {
  clearSessionCookie,
  hashToken,
  newSessionToken,
  requestToken,
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
  // Present only for the iPhone app: its S256 challenge, checked when it trades the code, and
  // when its sign-in started (ms), which the provider's login must not predate.
  native: z.object({ challenge: z.string(), started: z.number() }).optional(),
});
type Transaction = z.infer<typeof txSchema>;

// Signed, so it is ours, but an older version of the app may have written another shape.
function parseTransaction(raw: string) {
  try {
    return txSchema.parse(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

// Set on a request that belongs to the iPhone app's sign-in, so a failure goes back to its sheet.
type AuthEnv = { Variables: { native: boolean } };

// A failed sign-in never answers an error page: it goes back to the app, which shows a localized
// message and the Sign in link. An installed iOS PWA has no browser chrome to recover from a
// dead end, and the iPhone app's sheet only closes on its own address.
const signinFailure = (c: Context<AuthEnv>, reason: SigninFailure) =>
  c.redirect(c.get("native") ? nativeCallback({ error: reason }) : `/?signin=${reason}`);

const tokenRequest = z.object({
  code: z.string().min(1).max(100),
  verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
});

export function authRoutes(cfg: Config, db: Db, getOidc: OidcProvider) {
  const auth = new Hono<AuthEnv>();
  const codes = nativeCodes();
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
    // Logout and the code exchange are fetch() calls that expect JSON; everything else here is a
    // browser navigation.
    if (c.req.path === "/auth/logout" || c.req.path === "/auth/native/token") {
      return c.json({ error: "server_error" }, 500);
    }
    return signinFailure(c, "failed");
  });

  async function beginLogin(
    c: Context<AuthEnv>,
    tx: Pick<Transaction, "state" | "returnTo" | "native">,
    extra: { prompt?: "login" } = {},
  ) {
    let oidc: client.Configuration;
    try {
      oidc = await getOidc();
    } catch (err) {
      console.error("OIDC discovery failed:", describeError(err));
      return signinFailure(c, "unavailable");
    }
    const verifier = client.randomPKCECodeVerifier();
    const nonce = client.randomNonce();
    await setSignedCookie(
      c,
      TX_COOKIE,
      JSON.stringify({ ...tx, verifier, nonce }),
      cfg.sessionSecret,
      { ...txCookieOpts, maxAge: 600 },
    );
    const url = client.buildAuthorizationUrl(oidc, {
      redirect_uri: redirectUri,
      scope: "openid profile",
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state: tx.state,
      nonce,
      ...extra,
    });
    return c.redirect(url.href);
  }

  auth.get("/login", (c) =>
    beginLogin(c, {
      state: client.randomState(),
      returnTo: safeReturnTo(c.req.query("returnTo")),
    }),
  );

  // The app's sheet opens this with the challenge of a verifier it keeps to itself. The server
  // stays the provider's client, with the web's redirect URI and its own PKCE.
  auth.get("/native/start", (c) => {
    c.set("native", true);
    const challenge = c.req.query("challenge");
    if (!challenge || !CHALLENGE.test(challenge)) return signinFailure(c, "failed");
    // The provider always shows its login: another app holding the scheme could open this
    // address with its own challenge, and must not ride a session the browser already has.
    return beginLogin(
      c,
      {
        state: NATIVE_STATE + client.randomState(),
        returnTo: "/",
        native: { challenge, started: Date.now() },
      },
      { prompt: "login" },
    );
  });

  auth.get("/callback", async (c) => {
    const raw = await getSignedCookie(c, cfg.sessionSecret, TX_COOKIE, txCookieOpts.prefix);
    deleteCookie(c, TX_COOKIE, txCookieOpts);
    const tx = raw ? parseTransaction(raw) : undefined;
    // Without its cookie, only the state tells an app sign-in from a web one.
    c.set(
      "native",
      tx ? tx.native !== undefined : (c.req.query("state")?.startsWith(NATIVE_STATE) ?? false),
    );
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
    if (tx.native && !loggedInSince(claims.auth_time, tx.native.started)) {
      console.error("native sign-in refused: the ID token shows no login since the start");
      return signinFailure(c, "failed");
    }
    const { requiredRole, rolesClaim } = cfg.oidc;
    if (requiredRole && !hasRole(claims, rolesClaim, requiredRole)) {
      return signinFailure(c, "denied");
    }

    const userId = await upsertUser(db, {
      issuer: claims.iss,
      sub: claims.sub,
      displayName: pickDisplayName(claims, cfg.oidc.nameClaim),
    });
    // The app gets a one-time code, never a session: the session is created when the app proves
    // it holds the verifier, and no cookie reaches the sheet.
    if (tx.native) {
      return c.redirect(nativeCallback({ code: codes.issue(userId, tx.native.challenge) }));
    }
    const token = newSessionToken();
    await createSession(db, hashToken(token, cfg.tokenHashKey), userId, cfg.sessionTtlDays);
    setSessionCookie(c, cfg, token);
    // Re-validated: the login side already did it, but the redirect must never rely on that alone.
    return c.redirect(safeReturnTo(tx.returnTo));
  });

  // Every refusal reads the same, so a caller learns nothing about which check failed.
  auth.post(
    "/native/token",
    bodyLimit({ maxSize: 4096, onError: (c) => c.json({ error: "too_large" }, 413) }),
    async (c) => {
      const body = tokenRequest.safeParse(await c.req.json().catch(() => undefined));
      const userId = body.success ? codes.redeem(body.data.code, body.data.verifier) : null;
      if (!userId) return c.json({ error: "invalid_grant" }, 400);
      const token = newSessionToken();
      await createSession(db, hashToken(token, cfg.tokenHashKey), userId, cfg.sessionTtlDays);
      return c.json({ token });
    },
  );

  auth.post("/logout", async (c) => {
    const { token, from } = requestToken(c, cfg);
    // Cleared first: if the database fails, the browser is still logged out. A bearer request
    // comes from the app, which holds no cookie and drops its token itself.
    if (from === "cookie") clearSessionCookie(c, cfg);
    if (token) {
      try {
        await deleteSession(db, hashToken(token, cfg.tokenHashKey));
      } catch (err) {
        // The cookie is already gone, or the app drops its token: the device is logged out, and
        // the server-side row lapses with the session lifetime.
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
