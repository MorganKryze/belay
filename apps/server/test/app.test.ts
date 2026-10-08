import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
import { hashToken, newSessionToken, SESSION_COOKIE } from "../src/auth/session";
import { loadConfig } from "../src/config";
import { connect } from "../src/db/client";
import { createSession, upsertUser } from "../src/db/identity";
import { testEnv } from "./config";
import { testDb } from "./db";

const { db } = testDb();
const dist = mkdtempSync(join(tmpdir(), "belay-web-"));
mkdirSync(join(dist, "assets"));
writeFileSync(join(dist, "index.html"), "<!doctype html><title>Belay</title>");
writeFileSync(join(dist, "assets", "app-abc.js"), "console.log(1)");

const cfg = loadConfig(
  testEnv({ OIDC_ISSUER: "http://localhost:1", WEB_DIST: relative(process.cwd(), dist) }),
);
const app = createApp({ cfg, db, getOidc: oidcProvider(cfg.oidc) });

describe("app", () => {
  it("reports health when the database answers", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("reports 503 when the database does not", async () => {
    const dead = connect("postgres://nobody:nothing@localhost:1/none");
    const res = await createApp({ cfg, db: dead.db, getOidc: oidcProvider(cfg.oidc) }).request(
      "/healthz",
    );
    expect(res.status).toBe(503);
    await dead.client.end();
  });

  it("serves the PWA and falls back to index.html for client routes", async () => {
    const res = await app.request("/settings");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<title>Belay</title>");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("caches hashed assets forever", async () => {
    const res = await app.request("/assets/app-abc.js");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("never answers /api or /auth paths with the app shell", async () => {
    const res = await app.request("/api/nope");
    expect(res.status).toBe(401); // the auth middleware guards all of /api/*
    expect(await res.text()).not.toContain("<title>");
    const auth = await app.request("/auth/nope");
    expect(auth.status).toBe(404);
    expect(await auth.text()).not.toContain("<title>");
  });

  it("sends a strict content security policy and no framing", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("content-security-policy")!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("rejects a cross-site form post to logout", async () => {
    const res = await app.request("/auth/logout", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    expect(res.status).toBe(403);
  });

  it("answers a missing hashed asset with 404, never the app shell cached as immutable", async () => {
    const res = await app.request("/assets/app-gone.js");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).not.toContain("<title>");
  });

  it("answers an unknown /api path with JSON 404 once signed in", async () => {
    const user = await upsertUser(db, {
      issuer: "https://idp.test",
      sub: "app-1",
      displayName: "Ada",
    });
    const token = newSessionToken();
    await createSession(db, hashToken(token, cfg.tokenHashKey), user, 30);
    const res = await app.request("/api/nope", {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("serves the app shell to GET only", async () => {
    const res = await app.request("/settings", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("<title>");
  });

  it("sends Strict-Transport-Security over https only", async () => {
    expect((await app.request("/")).headers.get("strict-transport-security")).toBeNull();
    const secure = loadConfig(
      testEnv({
        PUBLIC_URL: "https://belay.example",
        OIDC_ISSUER: "http://localhost:1",
        WEB_DIST: cfg.webDist,
      }),
    );
    const res = await createApp({ cfg: secure, db, getOidc: oidcProvider(secure.oidc) }).request(
      "/",
    );
    // No includeSubDomains: the app only knows its own origin, not what else lives under the domain.
    expect(res.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });
});
