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
   - `BELAY_APP_PASSWORD`: `openssl rand -hex 24`, URL-safe too. Belay
     connects to the database as the `belay_app` role with this password; the
     owner account of `POSTGRES_PASSWORD` only runs the migrations at startup.
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

   The three secrets are empty in the example on purpose: Compose and the app
   refuse to start until you set them.

3. Choose the image, then start it:
   - **Release image** (the default): `ghcr.io/morgankryze/belay:latest` follows
     the newest stable version tag; pre-releases (tags with a `-`) never move
     it. To pin a version, set `BELAY_IMAGE=ghcr.io/morgankryze/belay:1.2.3`
     (or the version you want) in `docker/.env`.
   - **From source**: run `docker build -f docker/Dockerfile -t belay:dev .`,
     then set `BELAY_IMAGE=belay:dev` in `docker/.env` (or in your shell).

   Then start it:

   ```bash
   docker compose -f docker/compose.yaml up -d
   ```

4. Point your reverse proxy at `127.0.0.1:3000`. Compose publishes Belay on
   loopback only (`BELAY_PORT` in `.env` changes the port), and that is
   deliberate: Docker publishes ports around host firewalls such as ufw, so
   binding every interface would expose the app without TLS.

### Running it

- `GET /healthz` reports health: `{"ok":true}`, or 503 when the database is
  unreachable. Migrations run at startup.
- The app boots and serves the PWA even when your identity provider is down:
  sign-in then shows a message on the home page, and you can try again.
- To update a release image, run `docker compose -f docker/compose.yaml pull`,
  then `up -d` again. From source, rebuild the image, then `up -d`. An installed
  app applies a new version on the launch after the one that downloaded it, once
  the app has been fully closed.
- Coming from a version without `BELAY_APP_PASSWORD`: add it to `.env` and
  take the new `compose.yaml` before `up -d`, or the app refuses to start
  (it no longer connects as the database owner). That update also signs
  everyone out once.
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
- **Inside the app**, Belay connects to the database as `belay_app`, a role
  that owns no table; the owner account only runs the migrations at startup.
  Row-level security limits every query to the signed-in person's rows, which
  guards against a bug in the application logic, such as a query that forgets
  its user filter. An SQL injection could not change the schema, leave the
  role or read the sessions table, but it could still claim to be another
  person and read their data. Parameterised queries are what prevent
  injection.
- **Sign-in** goes through your OIDC provider. The browser never sees an
  identity token: the server keeps the session and gives the browser an
  `HttpOnly` cookie. The database stores each session token only as a hash
  keyed from `SESSION_SECRET`, so write access to the database alone cannot
  create a session. A session lasts `SESSION_TTL_DAYS` (30) after its last
  use and never more than `SESSION_MAX_DAYS` (90) after sign-in. Disabling
  someone at your identity provider does not end an active Belay session: it
  runs until that deadline, at most `SESSION_MAX_DAYS` days.
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

The database takes port 5432: stop a local Postgres first, or change the host
port, the middle field of `-p 127.0.0.1:5432:5432` (and the port in
`DATABASE_URL`). Remove it with `docker rm -fv belay-dev-db`; `-v` also drops its
anonymous volume.

In development the server reads the **repository-root** `.env`, not
`docker/.env`. Edit it first:

- add `DATABASE_URL=postgres://postgres:dev@localhost:5432/belay`, or point it
  at any Postgres 18 (the Compose `db` service is not published to the host),
  and `APP_DATABASE_URL=postgres://belay_app:dev-app@localhost:5432/belay`
  (any password: the server gives it to the `belay_app` role at startup);
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
