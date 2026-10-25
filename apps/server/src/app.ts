import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import { apiRoutes } from "./api/routes";
import type { OidcProvider } from "./auth/oidc";
import { authRoutes } from "./auth/routes";
import { NATIVE_ORIGIN } from "./auth/session";
import type { Config } from "./config";
import type { Db } from "./db/client";
import { describeError } from "./log";
import { mediaRoutes } from "./media";

// Answers that carry a session or a person's data are never kept by a browser or a proxy.
const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};

export function createApp({ cfg, db, getOidc }: { cfg: Config; db: Db; getOidc: OidcProvider }) {
  const app = new Hono();

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // ponytail: 'unsafe-inline' styles because Radix positions popovers with inline style attributes; nonce-based styles if that ever matters.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        mediaSrc: ["'self'"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "same-origin",
      // No includeSubDomains: the app only knows its own origin, not what else lives under the domain.
      strictTransportSecurity: cfg.secureCookies ? "max-age=31536000" : false,
    }),
  );
  // The iPhone app calls from its own origin with a bearer token, never a cookie, so no
  // credentials. Any other origin gets no Access-Control-Allow-Origin and its browser refuses.
  const native = cors({
    origin: (origin) => (origin === NATIVE_ORIGIN ? origin : null),
    allowMethods: ["GET", "HEAD", "POST"],
    allowHeaders: ["Authorization", "Content-Type"],
    maxAge: 600,
  });
  for (const path of ["/api/*", "/media/*", "/auth/native/*", "/auth/logout"]) {
    app.use(path, native);
  }
  app.use(csrf({ origin: cfg.publicUrl.origin }));
  app.use("/api/*", noStore);
  app.use("/auth/*", noStore);

  // Printed as text through describeError: a database error's message holds its parameters.
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    console.error("server error:", describeError(err));
    return c.req.path.startsWith("/api/")
      ? c.json({ error: "server_error" }, 500)
      : c.text("Internal Server Error", 500);
  });

  app.get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  // Public on purpose: the web app already tells anyone it is Belay, and the iPhone app needs the
  // origin where sign-in lives before it has a session.
  app.get("/api/instance", (c) => c.json({ app: "belay", api: 1, origin: cfg.publicUrl.origin }));
  app.route("/auth", authRoutes(cfg, db, getOidc));
  app.route("/api", apiRoutes(cfg, db));
  app.all("/auth/*", (c) => c.text("Not found", 404));
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  // Before the shell: a missing loop is a JSON 404, never index.html cached as a video.
  app.route("/media", mediaRoutes(cfg, db));
  app.all("/media/*", (c) => c.json({ error: "not_found" }, 404));

  // ponytail: assets get no conditional requests (ETag/304), so every revalidation re-sends the whole file.
  // Upgrade: an ETag layer in front of serveStatic.

  // Hashed build output: a missing file is a plain 404, never the app shell cached as immutable.
  app.get(
    "/assets/*",
    async (c, next) => {
      await next();
      c.header("Cache-Control", c.res.ok ? "public, max-age=31536000, immutable" : "no-store");
    },
    serveStatic({ root: cfg.webDist }),
    (c) => c.text("Not found", 404),
  );
  // ponytail: the SPA fallback answers every missing non-asset path with the shell (200, HTML).
  // Upgrade: fall back only for extension-less paths, or when Accept includes text/html.
  app.get(
    "*",
    async (c, next) => {
      await next();
      if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-cache");
    },
    serveStatic({ root: cfg.webDist }),
    serveStatic({ root: cfg.webDist, path: "index.html" }),
  );

  return app;
}
