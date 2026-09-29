#!/usr/bin/env bash
# Boots the image with a real Postgres and checks what a person would hit first.
# No identity provider on purpose: the app must serve and stay healthy without one.
# Uses its own env file and compose project, so a local .env and dev stack are untouched.
set -euo pipefail
image="${1:?usage: scripts/smoke.sh <image>}"
env_file=$(mktemp)
compose=(docker compose -p belay-smoke -f docker/compose.yaml --env-file "$env_file")
trap '"${compose[@]}" down -v >/dev/null 2>&1; rm -f "$env_file"' EXIT

cat > "$env_file" <<ENV
POSTGRES_PASSWORD=smoke
PUBLIC_URL=http://localhost:3000
OIDC_ISSUER=http://localhost:1
OIDC_CLIENT_ID=smoke
OIDC_CLIENT_SECRET=smoke
SESSION_SECRET=$(head -c 48 /dev/urandom | base64 | tr -d '\n')
ENV

BELAY_IMAGE="$image" BELAY_ENV_FILE="$env_file" "${compose[@]}" up -d --wait

curl -fsS http://localhost:3000/healthz | grep -q '"ok":true'
curl -fsS http://localhost:3000/ | grep -q '<title>Belay</title>'
curl -fsS http://localhost:3000/settings | grep -q '<title>Belay</title>'
curl -fsSI http://localhost:3000/ | grep -qi '^content-security-policy:'
curl -fsS http://localhost:3000/manifest.webmanifest | grep -q '"name":"Belay"'
test "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/me)" = 401
test "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/auth/login)" = 503
echo "smoke: ok"
