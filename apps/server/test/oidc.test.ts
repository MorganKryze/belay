import { describe, expect, it } from "vitest";
import { oidcProvider, pickDisplayName } from "../src/auth/oidc";
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
