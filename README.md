# Belay

To belay is to hold the rope for your climbing partner so they don't fall.
Belay does that for training: a self-hosted tracker for fat loss and strength
training, built for friends who cheer each other on.

- **Rules with sources.** Weekly averages instead of daily noise, loss rate in
  percent per week, fractional sets per muscle, double progression. Every rule
  shows its formula, its sources and its limits, inside the app.
- **Private by default.** You see your own data. You choose what to share, with
  whom, one kind of data at a time. Victories get celebrated; absences never get
  mentioned; nobody gets ranked.
- **Built for the gym floor.** Installs as an app, works offline for hours or
  days, syncs when the network is back, usable with one hand.

> Belay is not medical advice.

Status: early development. The first milestone is the foundation: sign-in,
database and an installable offline shell.

## Self-hosting

Requirements: Docker with Compose, an OpenID Connect provider (Keycloak,
Authentik, Pocket ID or any other standard one) and a reverse proxy that
terminates TLS on the same host. Belay has no accounts of its own.

1. Register a **confidential** OIDC client:
   - redirect URI: `https://<your-domain>/auth/callback`
   - post-logout redirect URI: `https://<your-domain>/`
   - scopes: `openid profile`
2. Create the env file. Compose reads one `.env` next to `docker/compose.yaml`,
   for its own substitutions and as the app's environment:

   ```bash
   cp .env.example docker/.env
   ```

   If you downloaded only `compose.yaml`, put `.env` beside it. Then fill it in:
   - `POSTGRES_PASSWORD`: `openssl rand -hex 24`. It goes into a database URL,
     so keep it URL-safe.
   - `SESSION_SECRET`: `openssl rand -hex 32`.
   - `PUBLIC_URL`: the https address people will use.
   - `OIDC_ISSUER`: the issuer URL your provider publishes at
     `/.well-known/openid-configuration` (for Keycloak,
     `https://<host>/realms/<realm>`; for Authentik,
     `https://<host>/application/o/<slug>/`), with `OIDC_CLIENT_ID` and
     `OIDC_CLIENT_SECRET` from step 1.
   - `OIDC_NAME_CLAIM`: the claim shown as the display name (default `name`,
     falling back to `preferred_username`). `email` is refused: Belay never
     stores e-mail addresses.

   Both secrets are empty in the example on purpose: Compose and the app
   refuse to start until you set them.

3. Start it:

   ```bash
   docker compose -f docker/compose.yaml up -d
   ```

   Release images are published to `ghcr.io/morgankryze/belay` when a version is
   tagged (none yet). To run the current source instead, build it with
   `docker build -f docker/Dockerfile -t belay:dev .` and add
   `BELAY_IMAGE=belay:dev` to `docker/.env`.

4. Point your reverse proxy at `127.0.0.1:3000`. Compose publishes Belay on
   loopback only (`BELAY_PORT` in `.env` changes the port), and that is
   deliberate: Docker publishes ports around host firewalls such as ufw, so
   binding every interface would expose the app without TLS.

### Running it

- `GET /healthz` reports health: `{"ok":true}`, or 503 when the database is
  unreachable. Migrations run at startup.
- The app boots and serves the PWA even when your identity provider is down;
  sign-in answers 503 until it is back.
- To update, run `docker compose -f docker/compose.yaml pull`, then `up -d`
  again. An installed app picks up the new version once it is fully closed and
  reopened.
- Your data lives in the `belay_db` volume of the `belay` Compose project.
  `down -v` deletes it. See the threat model below.

## Threat model

Read this before hosting Belay for anyone else.

- **The administrator of an instance can technically read its data.** Belay
  does not use end-to-end encryption; an administrator commits not to look.
  Host it for people who trust you.
- **Encryption at rest is your job.** The `belay_db` volume holds health data:
  put it on an encrypted disk and encrypt your backups. That protects against a
  stolen disk or a leaked backup, not against the administrator.
- **Inside the app**, queries run under a restricted database role with
  row-level security. This guards against a bug in the application logic, such
  as a query that forgets its user filter. It is not a boundary against SQL
  injection: with arbitrary SQL, an attacker can leave the role. Parameterised
  queries are what prevent injection.
- **Sign-in** goes through your OIDC provider. The browser never sees an
  identity token: the server keeps the session and gives the browser an
  `HttpOnly` cookie.
- **Minimal data**: from your identity provider, Belay keeps an identifier and a
  display name. Never your e-mail address.

## Contributing

You need Node 24 (see `.nvmrc`), pnpm, and Docker. The repository is a pnpm
workspace: `apps/server` (Hono), `apps/web` (React PWA) and `packages/shared`.

```bash
pnpm install
docker run -d --name belay-dev-db -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=belay \
  -p 127.0.0.1:5432:5432 postgres:18-alpine
cp .env.example .env
```

In development the server reads the **repository-root** `.env`, not
`docker/.env`. Edit it first:

- add `DATABASE_URL=postgres://postgres:dev@localhost:5432/belay`, or point it
  at any Postgres 18 (the Compose `db` service is not published to the host);
- set `PUBLIC_URL=http://localhost:5173` so the OIDC redirect goes through the
  Vite proxy, and register `http://localhost:5173/auth/callback` on a dev OIDC
  client;
- fill in `SESSION_SECRET` and the `OIDC_*` values. `POSTGRES_PASSWORD` is only
  for Compose.

Then start both halves:

```bash
pnpm --filter @belay/server dev
pnpm --filter @belay/web dev   # http://localhost:5173
```

CI runs `pnpm lint`, `pnpm typecheck`, `pnpm test` (starts PostgreSQL through
Testcontainers, so it needs Docker), `pnpm build`, `pnpm size` (bundle budget)
and `pnpm e2e` (Playwright: install its browser once with
`pnpm --filter @belay/web exec playwright install chromium`). It also builds
the image and runs `scripts/smoke.sh <image>` against it. `pnpm format` fixes
formatting.

## Colophon

A colophon tells how the book was made, so here is mine: TypeScript, React,
Hono and PostgreSQL, and [Claude Code](https://claude.com/claude-code) drafting
at my side, never on autopilot. The taste, the reviews and the final word stay
mine; the tests, the CI and the public history keep me honest.

## License

Free software under [AGPL-3.0](LICENSE): use it, modify it, share it. If you
run a modified Belay for other people over a network, you offer them its
source code too.
