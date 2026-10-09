import { hkdfSync } from "node:crypto";
import { z } from "zod";

export const APP_ROLE = "belay_app";
const APP_URL_RULE = `must be a postgres:// URL for the ${APP_ROLE} role, with its password (Belay connects as ${APP_ROLE}; DATABASE_URL only runs the migrations)`;

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_DATABASE_URL: z.string({ error: APP_URL_RULE }),
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
  // Optional: when OIDC_REQUIRED_ROLE is set, only people whose ID token lists it may sign in.
  // OIDC_ROLES_CLAIM is a dotted path to that list (default `groups`).
  OIDC_REQUIRED_ROLE: z.string().optional(),
  OIDC_ROLES_CLAIM: z.string().optional(),
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().max(400).default(30),
  SESSION_MAX_DAYS: z.coerce.number().int().positive().max(400).default(90),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_DIST: z.string().default("../web/dist"),
  MIGRATIONS_DIR: z.string().default("drizzle"),
});

export type Config = {
  databaseUrl: string;
  appDatabaseUrl: string;
  appPassword: string;
  publicUrl: URL;
  oidc: {
    issuer: URL;
    clientId: string;
    clientSecret: string;
    nameClaim: string;
    requiredRole: string | undefined;
    rolesClaim: string;
    allowInsecure: boolean;
  };
  sessionSecret: string;
  tokenHashKey: Buffer;
  sessionTtlDays: number;
  sessionMaxDays: number;
  secureCookies: boolean;
  port: number;
  webDist: string;
  migrationsDir: string;
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// The password of APP_DATABASE_URL, read the way postgres.js reads it (percent-decoded), or
// undefined when the URL is not one for the app role. Query parameters that postgres.js would copy
// into the startup packet to change the user or role are refused too, so a mistake fails here, with
// a clear message (the startup check on the session role stays the backstop).
function appRolePassword(url: string): string | undefined {
  const u = URL.parse(url);
  if (!u || (u.protocol !== "postgres:" && u.protocol !== "postgresql:")) return undefined;
  for (const key of u.searchParams.keys()) {
    if (["user", "options", "role"].includes(key.toLowerCase())) return undefined;
  }
  try {
    const password = decodeURIComponent(u.password);
    return decodeURIComponent(u.username) === APP_ROLE && password ? password : undefined;
  } catch {
    return undefined;
  }
}

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
  if (e.SESSION_MAX_DAYS < e.SESSION_TTL_DAYS) {
    throw new Error("Invalid configuration:\nSESSION_MAX_DAYS must be at least SESSION_TTL_DAYS");
  }
  const requiredRole = e.OIDC_REQUIRED_ROLE?.trim() || undefined;
  const rolesClaim = e.OIDC_ROLES_CLAIM ?? "groups";
  if (requiredRole && rolesClaim.split(".").some((segment) => !segment.trim())) {
    throw new Error(
      "Invalid configuration:\nOIDC_ROLES_CLAIM must be a claim path such as groups or realm_access.roles, with no empty part",
    );
  }
  const appPassword = appRolePassword(e.APP_DATABASE_URL);
  if (appPassword === undefined) {
    throw new Error(`Invalid configuration:\nAPP_DATABASE_URL ${APP_URL_RULE}`);
  }
  const publicUrl = new URL(e.PUBLIC_URL);
  return {
    databaseUrl: e.DATABASE_URL,
    appDatabaseUrl: e.APP_DATABASE_URL,
    appPassword,
    publicUrl,
    oidc: {
      issuer,
      clientId: e.OIDC_CLIENT_ID,
      clientSecret: e.OIDC_CLIENT_SECRET,
      nameClaim: e.OIDC_NAME_CLAIM,
      requiredRole,
      rolesClaim,
      allowInsecure: insecure,
    },
    sessionSecret: e.SESSION_SECRET,
    // One key per purpose: SESSION_SECRET itself signs the login transaction cookie.
    tokenHashKey: Buffer.from(
      hkdfSync("sha256", e.SESSION_SECRET, "", "belay/session-token-hash/v1", 32),
    ),
    sessionTtlDays: e.SESSION_TTL_DAYS,
    sessionMaxDays: e.SESSION_MAX_DAYS,
    secureCookies: publicUrl.protocol === "https:",
    port: e.PORT,
    webDist: e.WEB_DIST,
    migrationsDir: e.MIGRATIONS_DIR,
  };
}
