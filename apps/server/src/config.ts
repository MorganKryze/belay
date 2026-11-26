import { hkdfSync } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { parse } from "node:path";
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
  // Optional: the folder of exercise loops (<four digits>.mp4). Unset or blank turns media off.
  BELAY_MEDIA_DIR: z.string().optional(),
  // Optional: who runs this instance and how to reach them, shown on its privacy page.
  BELAY_OPERATOR: z.string().optional(),
  BELAY_PRIVACY_CONTACT: z.string().optional(),
  BELAY_SUPPORT_CONTACT: z.string().optional(),
  BELAY_DATA_LOCATION: z.string().optional(),
  BELAY_BACKUP_DAYS: z
    .string()
    .transform((v) => v || undefined)
    .pipe(
      z
        .string()
        .regex(/^\s*\d+\s*$/, { error: "must be a whole number of days" })
        .transform(Number)
        .optional(),
    )
    .optional(),
});

export type Privacy = {
  operator: string | null;
  contact: string | null;
  support: string | null;
  location: string | null;
  backupDays: number | null;
};

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
  // The media directory's real path, resolved once here; undefined means media is off.
  mediaDir: string | undefined;
  privacy: Privacy;
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

// Resolved once at startup: every loop path is later checked against this real path, so a link in
// the configured path cannot move the boundary while the server runs.
function mediaDirectory(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  let real: string | undefined;
  try {
    real = realpathSync(value);
    if (!statSync(real).isDirectory()) real = undefined;
  } catch {
    // Missing or unreadable: refused below with the same message as a file.
  }
  // The root would make the containment prefix "//", which no loop path matches.
  if (real !== undefined && parse(real).root === real) {
    throw new Error(
      "Invalid configuration:\nBELAY_MEDIA_DIR must not be the filesystem root (the folder of <number>.mp4 loops)",
    );
  }
  if (real !== undefined) return real;
  throw new Error(
    "Invalid configuration:\nBELAY_MEDIA_DIR must be an existing directory (the folder of <number>.mp4 loops)",
  );
}

const EMAIL = /^[^\s@:/?#]+@[^\s@:/?#]+\.[^\s@:/?#.]+$/;

// A contact the apps open as a link: one plain address (served as its mailto:), a mailto: of one
// plain address, or an https URL with a host. Unset or empty means not given; anything else stops
// the start.
function contact(name: string, value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  const given = value.trim();
  const url = URL.parse(EMAIL.test(given) ? `mailto:${given}` : given);
  if (url === null || !(url.protocol === "https:" ? url.hostname !== "" : mailto(url))) {
    throw new Error(`Invalid configuration:\n${name} must be an e-mail address or an https URL`);
  }
  // Served as the parser reads it, so every app opens the same link.
  return url.href;
}

function mailto(url: URL): boolean {
  if (url.protocol !== "mailto:" || url.search) return false;
  try {
    return EMAIL.test(decodeURIComponent(url.pathname));
  } catch {
    return false;
  }
}

// Shown as one line on the privacy page: no line break, no control or direction-changing character.
const LOCATION_MAX = 200;
const UNSAFE_TEXT = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

function location(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.length > LOCATION_MAX || UNSAFE_TEXT.test(text)) {
    throw new Error(
      `Invalid configuration:\nBELAY_DATA_LOCATION must be one line of at most ${LOCATION_MAX} characters`,
    );
  }
  return text;
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
  // Unset or empty means no filter; a blank value is a typo, and must not leave sign-in open.
  if (e.OIDC_REQUIRED_ROLE && !e.OIDC_REQUIRED_ROLE.trim()) {
    throw new Error(
      "Invalid configuration:\nOIDC_REQUIRED_ROLE must not be blank (leave it unset to allow everyone)",
    );
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
  const mediaDir = mediaDirectory(e.BELAY_MEDIA_DIR);
  const privacy: Privacy = {
    operator: contact("BELAY_OPERATOR", e.BELAY_OPERATOR),
    contact: contact("BELAY_PRIVACY_CONTACT", e.BELAY_PRIVACY_CONTACT),
    support: contact("BELAY_SUPPORT_CONTACT", e.BELAY_SUPPORT_CONTACT),
    location: location(e.BELAY_DATA_LOCATION),
    backupDays: e.BELAY_BACKUP_DAYS ?? null,
  };
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
    mediaDir,
    privacy,
  };
}
