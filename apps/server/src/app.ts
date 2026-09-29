import { serveStatic } from "@hono/node-server/serve-static";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { apiRoutes } from "./api/routes";
import type { OidcProvider } from "./auth/oidc";
import { authRoutes } from "./auth/routes";
import type { Config } from "./config";
import type { Db } from "./db/client";

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
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
      referrerPolicy: "same-origin",
      strictTransportSecurity: cfg.secureCookies ? "max-age=31536000; includeSubDomains" : false,
    }),
  );
  app.use(csrf({ origin: cfg.publicUrl.origin }));

  app.get("/healthz", async (c) => {
    try {
      await db.execute(sql`select 1`);
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });

  app.route("/auth", authRoutes(cfg, db, getOidc));
  app.route("/api", apiRoutes(cfg, db));
  app.all("/auth/*", (c) => c.text("Not found", 404));
  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

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
