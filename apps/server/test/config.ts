export function testEnv(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: "postgres://belay:belay@localhost:5432/belay",
    APP_DATABASE_URL: "postgres://belay_app:app@localhost:5432/belay",
    PUBLIC_URL: "http://localhost:3000",
    OIDC_ISSUER: "http://localhost:8080",
    OIDC_CLIENT_ID: "belay",
    OIDC_CLIENT_SECRET: "secret",
    SESSION_SECRET: "x".repeat(32),
    ...overrides,
  };
}
