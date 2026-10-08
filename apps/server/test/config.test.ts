import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { testEnv } from "./config";

describe("loadConfig", () => {
  it("names every missing variable in one readable error", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*OIDC_ISSUER[\s\S]*SESSION_SECRET/);
  });

  it("rejects a session secret shorter than 32 characters", () => {
    expect(() => loadConfig(testEnv({ SESSION_SECRET: "short" }))).toThrow(/SESSION_SECRET/);
  });

  it("accepts plain http for an issuer on localhost only", () => {
    expect(loadConfig(testEnv()).oidc.allowInsecure).toBe(true);
    expect(() => loadConfig(testEnv({ OIDC_ISSUER: "http://idp.example.com" }))).toThrow(
      /OIDC_ISSUER must use https/,
    );
  });

  it("derives secure cookies from an https public URL", () => {
    expect(loadConfig(testEnv()).secureCookies).toBe(false);
    expect(
      loadConfig(testEnv({ PUBLIC_URL: "https://belay.libresoftware.cloud" })).secureCookies,
    ).toBe(true);
  });

  it("applies defaults", () => {
    const cfg = loadConfig(testEnv());
    expect(cfg).toMatchObject({
      sessionTtlDays: 30,
      sessionMaxDays: 90,
      port: 3000,
      oidc: { nameClaim: "name" },
    });
  });

  it("refuses an absolute session cap shorter than the sliding expiry", () => {
    expect(() => loadConfig(testEnv({ SESSION_MAX_DAYS: "29" }))).toThrow(
      /SESSION_MAX_DAYS must be at least SESSION_TTL_DAYS/,
    );
    expect(loadConfig(testEnv({ SESSION_MAX_DAYS: "30" })).sessionMaxDays).toBe(30);
  });

  it("bounds the session lifetimes at 400 days", () => {
    expect(loadConfig(testEnv({ SESSION_TTL_DAYS: "400", SESSION_MAX_DAYS: "400" }))).toMatchObject(
      { sessionTtlDays: 400, sessionMaxDays: 400 },
    );
    expect(() => loadConfig(testEnv({ SESSION_TTL_DAYS: "401" }))).toThrow(/SESSION_TTL_DAYS/);
    expect(() => loadConfig(testEnv({ SESSION_MAX_DAYS: "401" }))).toThrow(/SESSION_MAX_DAYS/);
  });

  it("accepts only http(s) URLs for PUBLIC_URL and OIDC_ISSUER", () => {
    expect(() => loadConfig(testEnv({ PUBLIC_URL: "belay.libresoftware.cloud:3000" }))).toThrow(
      /PUBLIC_URL/,
    );
    expect(() => loadConfig(testEnv({ PUBLIC_URL: "ftp://x" }))).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig(testEnv({ OIDC_ISSUER: "file:///etc/passwd" }))).toThrow(/OIDC_ISSUER/);
  });

  it("refuses to start without APP_DATABASE_URL, never falling back to the owner", () => {
    const env: Record<string, string> = testEnv();
    delete env.APP_DATABASE_URL;
    expect(() => loadConfig(env)).toThrow(/for the belay_app role[\s\S]*at APP_DATABASE_URL/);
  });

  it("accepts APP_DATABASE_URL only for belay_app, with a password, and never echoes it", () => {
    for (const url of [
      "postgres://belay:hunter2owner@db:5432/belay", // the owner
      "postgres://belay_app@db:5432/belay", // no password
      "postgres://belay_app:hunter2%zz@db:5432/belay", // broken percent-encoding
      "mysql://belay_app:hunter2@db/belay",
      "not a url",
    ]) {
      const err = (() => {
        try {
          loadConfig(testEnv({ APP_DATABASE_URL: url }));
        } catch (e) {
          return e as Error;
        }
      })();
      expect(err?.message, url).toMatch(/APP_DATABASE_URL must be a postgres:\/\/ URL/);
      expect(err?.message).not.toContain("hunter2");
    }
  });

  it("refuses APP_DATABASE_URL query parameters that override the user or role", () => {
    for (const param of ["user=belay", "options=-c%20role%3Dbelay", "role=belay", "USER=belay"]) {
      const url = `postgres://belay_app:app@db:5432/belay?application_name=x&${param}`;
      expect(() => loadConfig(testEnv({ APP_DATABASE_URL: url })), param).toThrow(
        /APP_DATABASE_URL must be a postgres:\/\/ URL/,
      );
    }
    const ok = "postgres://belay_app:app@db:5432/belay?application_name=x";
    expect(loadConfig(testEnv({ APP_DATABASE_URL: ok })).appDatabaseUrl).toBe(ok);
  });

  it("reads the app password the way postgres.js does, percent-decoded", () => {
    const password = `p@ss:w/rd?#% "it's"\\`;
    const cfg = loadConfig(
      testEnv({
        APP_DATABASE_URL: `postgresql://belay_app:${encodeURIComponent(password)}@db:5432/belay`,
      }),
    );
    expect(cfg.appPassword).toBe(password);
  });

  it("refuses the e-mail claim as the display name, whatever its case", () => {
    for (const claim of ["email", "EMAIL", "Email", " email "]) {
      expect(() => loadConfig(testEnv({ OIDC_NAME_CLAIM: claim }))).toThrow(/OIDC_NAME_CLAIM/);
    }
    expect(loadConfig(testEnv({ OIDC_NAME_CLAIM: "nickname" })).oidc.nameClaim).toBe("nickname");
  });
});
