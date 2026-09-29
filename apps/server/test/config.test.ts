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
    expect(cfg).toMatchObject({ sessionTtlDays: 30, port: 3000, oidc: { nameClaim: "name" } });
  });

  it("accepts only http(s) URLs for PUBLIC_URL and OIDC_ISSUER", () => {
    expect(() => loadConfig(testEnv({ PUBLIC_URL: "belay.libresoftware.cloud:3000" }))).toThrow(
      /PUBLIC_URL/,
    );
    expect(() => loadConfig(testEnv({ PUBLIC_URL: "ftp://x" }))).toThrow(/PUBLIC_URL/);
    expect(() => loadConfig(testEnv({ OIDC_ISSUER: "file:///etc/passwd" }))).toThrow(/OIDC_ISSUER/);
  });
});
