import * as client from "openid-client";
import type { Config } from "../config";

export type OidcProvider = () => Promise<client.Configuration>;

// Lazy and memoized: the app boots and serves the PWA even while the identity
// provider is down; a failed discovery is forgotten so the next login retries.
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

export function pickDisplayName(claims: Record<string, unknown>, nameClaim: string): string {
  for (const key of [nameClaim, "preferred_username"]) {
    const v = claims[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "Belay user";
}
