import { hkdfSync } from "node:crypto";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PUBLIC_URL: z.url({ protocol: /^https?$/ }),
  OIDC_ISSUER: z.url({ protocol: /^https?$/ }),
  OIDC_CLIENT_ID: z.string().min(1),
  OIDC_CLIENT_SECRET: z.string().min(1),
  OIDC_NAME_CLAIM: z
    .string()
    .min(1)
    .refine((claim) => claim.trim().toLowerCase() !== "email", {
      error: "must not be the e-mail claim: Belay never stores e-mail addresses",
    })
    .default("name"),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_DIST: z.string().default("../web/dist"),
  MIGRATIONS_DIR: z.string().default("drizzle"),
});

export type Config = {
  databaseUrl: string;
  publicUrl: URL;
  oidc: {
    issuer: URL;
    clientId: string;
    clientSecret: string;
    nameClaim: string;
    allowInsecure: boolean;
  };
  sessionSecret: string;
  tokenHashKey: Buffer;
  sessionTtlDays: number;
  secureCookies: boolean;
  port: number;
  webDist: string;
  migrationsDir: string;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const issuer = new URL(e.OIDC_ISSUER);
  const insecure = issuer.protocol === "http:";
  if (insecure && !LOOPBACK.has(issuer.hostname)) {
    throw new Error(
      "Invalid configuration:\nOIDC_ISSUER must use https (http is only accepted on localhost)",
    );
  }
  const publicUrl = new URL(e.PUBLIC_URL);
  return {
    databaseUrl: e.DATABASE_URL,
    publicUrl,
    oidc: {
      issuer,
      clientId: e.OIDC_CLIENT_ID,
      clientSecret: e.OIDC_CLIENT_SECRET,
      nameClaim: e.OIDC_NAME_CLAIM,
      allowInsecure: insecure,
    },
    sessionSecret: e.SESSION_SECRET,
    // One key per purpose: SESSION_SECRET itself signs the login transaction cookie.
    tokenHashKey: Buffer.from(
      hkdfSync("sha256", e.SESSION_SECRET, "", "belay/session-token-hash/v1", 32),
    ),
    sessionTtlDays: e.SESSION_TTL_DAYS,
    secureCookies: publicUrl.protocol === "https:",
    port: e.PORT,
    webDist: e.WEB_DIST,
    migrationsDir: e.MIGRATIONS_DIR,
  };
}
