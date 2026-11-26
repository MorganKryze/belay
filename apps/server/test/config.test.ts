import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_VERSION, CONSENT_VERSION } from "@belay/shared/sync/limits";
import { createApp } from "../src/app";
import { oidcProvider } from "../src/auth/oidc";
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

  it("requires no role by default, and ignores the roles claim then", () => {
    expect(loadConfig(testEnv()).oidc).toMatchObject({ requiredRole: undefined });
    expect(loadConfig(testEnv({ OIDC_REQUIRED_ROLE: "" })).oidc.requiredRole).toBeUndefined();
    expect(loadConfig(testEnv({ OIDC_ROLES_CLAIM: "a..b" })).oidc.requiredRole).toBeUndefined();
  });

  it("refuses a blank required role instead of leaving sign-in open", () => {
    for (const role of [" ", "  ", "\t"]) {
      expect(() => loadConfig(testEnv({ OIDC_REQUIRED_ROLE: role })), JSON.stringify(role)).toThrow(
        /OIDC_REQUIRED_ROLE must not be blank/,
      );
    }
  });

  it("reads the required role and looks in `groups` unless told otherwise", () => {
    expect(loadConfig(testEnv({ OIDC_REQUIRED_ROLE: "belay" })).oidc).toMatchObject({
      requiredRole: "belay",
      rolesClaim: "groups",
    });
    expect(
      loadConfig(
        testEnv({ OIDC_REQUIRED_ROLE: "belay", OIDC_ROLES_CLAIM: "resource_access.belay.roles" }),
      ).oidc.rolesClaim,
    ).toBe("resource_access.belay.roles");
  });

  it("refuses an empty roles claim path, or one with an empty segment, once a role is required", () => {
    for (const path of ["", " ", ".", "a.", ".a", "a..b"]) {
      expect(
        () => loadConfig(testEnv({ OIDC_REQUIRED_ROLE: "belay", OIDC_ROLES_CLAIM: path })),
        JSON.stringify(path),
      ).toThrow(/OIDC_ROLES_CLAIM/);
    }
  });

  it("media is off when BELAY_MEDIA_DIR is unset or blank", () => {
    expect(loadConfig(testEnv()).mediaDir).toBeUndefined();
    expect(loadConfig(testEnv({ BELAY_MEDIA_DIR: "" })).mediaDir).toBeUndefined();
    expect(loadConfig(testEnv({ BELAY_MEDIA_DIR: "  " })).mediaDir).toBeUndefined();
  });

  it("BELAY_MEDIA_DIR resolves to the directory's real path", () => {
    const base = mkdtempSync(join(tmpdir(), "belay-media-cfg-"));
    const target = join(base, "loops");
    mkdirSync(target);
    const link = join(base, "link");
    symlinkSync(target, link);
    expect(loadConfig(testEnv({ BELAY_MEDIA_DIR: link })).mediaDir).toBe(realpathSync(target));
  });

  it("refuses the filesystem root as BELAY_MEDIA_DIR, naming the variable", () => {
    for (const dir of ["/", "//", "/."]) {
      expect(() => loadConfig(testEnv({ BELAY_MEDIA_DIR: dir })), dir).toThrow(
        /Invalid configuration:\nBELAY_MEDIA_DIR must not be the filesystem root/,
      );
    }
  });

  it("refuses a BELAY_MEDIA_DIR that does not exist, or is a file, naming the variable", () => {
    const base = mkdtempSync(join(tmpdir(), "belay-media-cfg-"));
    const file = join(base, "0001.mp4");
    writeFileSync(file, "x");
    for (const dir of [join(base, "missing"), file]) {
      expect(() => loadConfig(testEnv({ BELAY_MEDIA_DIR: dir })), dir).toThrow(
        /Invalid configuration:\nBELAY_MEDIA_DIR must be an existing directory/,
      );
    }
  });
});

describe("the instance's privacy settings", () => {
  const privacyEnv = {
    BELAY_OPERATOR: "https://operator.example.org",
    BELAY_PRIVACY_CONTACT: "mailto:privacy@example.org",
    BELAY_SUPPORT_CONTACT: "https://example.org/help",
    BELAY_DATA_LOCATION: "Paris, France",
    BELAY_BACKUP_DAYS: "14",
  };

  it("refuses a malformed operator, contact or support", () => {
    for (const name of ["BELAY_OPERATOR", "BELAY_PRIVACY_CONTACT", "BELAY_SUPPORT_CONTACT"]) {
      for (const value of [
        "privacy@example.org",
        "mailto:not an address",
        "mailto:",
        "http://example.org",
        "ftp://example.org",
        "https://",
        "   ",
        "javascript:alert(1)",
        "mailto:privacy@example.org?subject=hi",
      ]) {
        expect(() => loadConfig(testEnv({ [name]: value })), `${name}=${value}`).toThrow(
          `Invalid configuration:\n${name} must be an e-mail address or an https URL`,
        );
      }
    }
    expect(loadConfig(testEnv(privacyEnv)).privacy).toEqual({
      operator: "https://operator.example.org/",
      contact: "mailto:privacy@example.org",
      support: "https://example.org/help",
      location: "Paris, France",
      backupDays: 14,
    });
  });

  it("serves each contact in its normalised form", () => {
    const cfg = loadConfig(
      testEnv({
        BELAY_OPERATOR: " HTTPS://Operator.Example.org ",
        BELAY_PRIVACY_CONTACT: "mailto:privacy@example.org",
        BELAY_SUPPORT_CONTACT: "https://example.org/a b",
      }),
    );
    expect(cfg.privacy).toMatchObject({
      operator: "https://operator.example.org/",
      contact: "mailto:privacy@example.org",
      support: "https://example.org/a%20b",
    });
  });

  it("refuses a contact whose escapes do not decode, in the usual words", () => {
    expect(() => loadConfig(testEnv({ BELAY_PRIVACY_CONTACT: "mailto:%E0@example.org" }))).toThrow(
      "Invalid configuration:\nBELAY_PRIVACY_CONTACT must be an e-mail address or an https URL",
    );
  });

  it("refuses a data location too long or holding a control character", () => {
    expect(loadConfig(testEnv({ BELAY_DATA_LOCATION: "x".repeat(200) })).privacy.location).toBe(
      "x".repeat(200),
    );
    for (const value of ["x".repeat(201), "Paris\nFrance", "Paris\u0007", "Paris\u202e"]) {
      expect(() => loadConfig(testEnv({ BELAY_DATA_LOCATION: value })), value).toThrow(
        "Invalid configuration:\nBELAY_DATA_LOCATION must be one line of at most 200 characters",
      );
    }
  });

  it("reads backup days as whole days", () => {
    expect(loadConfig(testEnv({ BELAY_BACKUP_DAYS: "" })).privacy.backupDays).toBeNull();
    expect(loadConfig(testEnv({ BELAY_BACKUP_DAYS: "0" })).privacy.backupDays).toBe(0);
    expect(loadConfig(testEnv({ BELAY_BACKUP_DAYS: "30" })).privacy.backupDays).toBe(30);
    for (const value of ["1.5", "-1", "two", "7d"]) {
      expect(() => loadConfig(testEnv({ BELAY_BACKUP_DAYS: value })), value).toThrow(
        /BELAY_BACKUP_DAYS/,
      );
    }
  });

  it("serves the settings and the consent version in /api/instance, each null when unset", async () => {
    const probe = { app: "belay", api: API_VERSION, origin: "http://localhost:3000" };
    const serve = (env: Record<string, string>) => {
      const cfg = loadConfig(testEnv(env));
      // No route here reaches the database or the identity provider.
      return createApp({ cfg, db: undefined as never, getOidc: oidcProvider(cfg.oidc) });
    };
    const set = await serve(privacyEnv).request("/api/instance");
    expect(await set.json()).toEqual({
      ...probe,
      consentVersion: CONSENT_VERSION,
      privacy: {
        operator: "https://operator.example.org/",
        contact: "mailto:privacy@example.org",
        support: "https://example.org/help",
        location: "Paris, France",
        backupDays: 14,
      },
    });
    const unset = await serve({ BELAY_DATA_LOCATION: "  " }).request("/api/instance");
    expect(await unset.json()).toEqual({
      ...probe,
      consentVersion: CONSENT_VERSION,
      privacy: { operator: null, contact: null, support: null, location: null, backupDays: null },
    });
  });
});
