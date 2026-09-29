import * as client from "openid-client";
import type { Config } from "../config";

export type OidcProvider = () => Promise<client.Configuration>;

// Lazy and memoized: the app boots and serves the PWA even while the identity
// provider is down; a failed discovery is forgotten so the next login retries.
// ponytail: a successful discovery is cached for the process lifetime, so an IdP that moves an
// endpoint needs a restart. Upgrade: honour the cache headers, or re-discover on key or endpoint
// errors.
export function oidcProvider(oidc: Config["oidc"]): OidcProvider {
  let pending: Promise<client.Configuration> | undefined;
  return () => {
    pending ??= client
      .discovery(
        oidc.issuer,
        oidc.clientId,
        oidc.clientSecret,
        undefined,
        oidc.allowInsecure ? { execute: [client.allowInsecureRequests] } : undefined,
      )
      .catch((err: unknown) => {
        pending = undefined;
        throw err;
      });
    return pending;
  };
}

// An "@" marks an e-mail address, which Belay never stores: some Keycloak realms use the e-mail
// as the username, so preferred_username is checked like any other candidate.
export function pickDisplayName(claims: Record<string, unknown>, nameClaim: string): string {
  for (const key of [nameClaim, "preferred_username"]) {
    const v = claims[key];
    if (typeof v !== "string") continue;
    const name = v.trim();
    if (name && !name.includes("@")) return name;
  }
  return "Belay user";
}
