import { describe, expect, it } from "vitest";
import { hasRole, oidcProvider, pickDisplayName } from "../src/auth/oidc";
import { loadConfig } from "../src/config";
import { testEnv } from "./config";
import { startIdp } from "./idp";

describe("pickDisplayName", () => {
  it("prefers the configured claim, then preferred_username, then a neutral fallback", () => {
    expect(pickDisplayName({ name: "Alex", preferred_username: "alex" }, "name")).toBe("Alex");
    expect(pickDisplayName({ nickname: "Al" }, "nickname")).toBe("Al");
    expect(pickDisplayName({ name: "  ", preferred_username: "alex" }, "name")).toBe("alex");
    expect(pickDisplayName({}, "name")).toBe("Belay user");
  });

  it("never returns an e-mail address, even as the username", () => {
    expect(pickDisplayName({ preferred_username: "a@b.c" }, "name")).toBe("Belay user");
    expect(pickDisplayName({ name: "x@y.z", preferred_username: "alex" }, "name")).toBe("alex");
    expect(pickDisplayName({ name: "  x@y.z ", preferred_username: " a@b.c" }, "name")).toBe(
      "Belay user",
    );
  });
});

describe("hasRole", () => {
  it("finds the role in an array, case-sensitively", () => {
    expect(hasRole({ groups: ["a", "belay"] }, "groups", "belay")).toBe(true);
    expect(hasRole({ groups: ["a", "b"] }, "groups", "belay")).toBe(false);
    expect(hasRole({ groups: ["Belay"] }, "groups", "belay")).toBe(false);
    expect(hasRole({ groups: ["belay-admin"] }, "groups", "belay")).toBe(false);
  });

  it("accepts a single string equal to the role", () => {
    expect(hasRole({ groups: "belay" }, "groups", "belay")).toBe(true);
    expect(hasRole({ groups: "other" }, "groups", "belay")).toBe(false);
  });

  it("follows a dotted path", () => {
    const claims = { resource_access: { belay: { roles: ["user"] } } };
    expect(hasRole(claims, "resource_access.belay.roles", "user")).toBe(true);
    expect(hasRole(claims, "resource_access.belay.roles", "admin")).toBe(false);
    expect(hasRole({ "a.b": ["user"] }, "a.b", "user")).toBe(false);
  });

  it("denies a missing path", () => {
    expect(hasRole({}, "groups", "belay")).toBe(false);
    expect(hasRole({ resource_access: {} }, "resource_access.belay.roles", "user")).toBe(false);
    expect(hasRole({ a: null }, "a.b", "user")).toBe(false);
    expect(hasRole({ a: "belay" }, "a.b", "belay")).toBe(false);
  });

  it("denies anything that is not a string or an array of strings", () => {
    expect(hasRole({ groups: [1, null, { belay: true }] }, "groups", "belay")).toBe(false);
    expect(hasRole({ groups: [["belay"]] }, "groups", "belay")).toBe(false);
    expect(hasRole({ groups: { belay: true } }, "groups", "belay")).toBe(false);
    expect(hasRole({ groups: true }, "groups", "belay")).toBe(false);
    expect(hasRole({ groups: 1 }, "groups", "1")).toBe(false);
  });

  it("does not walk the prototype chain", () => {
    expect(hasRole({}, "constructor.name", "Object")).toBe(false);
    expect(hasRole({}, "__proto__.x", "x")).toBe(false);
    const polluted = Object.create({ groups: ["belay"] }) as Record<string, unknown>;
    expect(hasRole(polluted, "groups", "belay")).toBe(false);
    // A real own `__proto__` key (as JSON.parse makes one) is data, and is reached like any other.
    const own = JSON.parse('{"__proto__":{"x":["x"]}}') as Record<string, unknown>;
    expect(hasRole(own, "__proto__.x", "x")).toBe(true);
  });
});

describe("oidcProvider", () => {
  it("retries discovery after a failure instead of caching it", async () => {
    const idp = await startIdp();
    const port = new URL(idp.issuer.url!).port;
    await idp.stop();
    try {
      const cfg = loadConfig(testEnv({ OIDC_ISSUER: `http://localhost:${port}` }));
      const getOidc = oidcProvider(cfg.oidc);
      await expect(getOidc()).rejects.toThrow();

      await idp.start(Number(port), "localhost");
      await expect(getOidc()).resolves.toBeDefined();
    } finally {
      await idp.stop().catch(() => {});
    }
  });
});
