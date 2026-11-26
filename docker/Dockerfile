# Pinned by digest and read through mirror.gcr.io (same object as Docker Hub,
# without the anonymous rate limit). Dependabot moves tag and digest together.
# The build stage runs on the builder's own architecture: the esbuild bundle and the
# vite dist are the same for every target, and the final stage has no RUN, so a
# multi-arch build never emulates the install or the build.
FROM --platform=$BUILDPLATFORM mirror.gcr.io/library/node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /src
# Node 25+ ships without corepack: pnpm comes from npm, pinned to packageManager's version.
COPY package.json ./
RUN npm i -g "$(node -p 'require("./package.json").packageManager')"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile
COPY . .
# The release tag, shown in Settings; "dev" for a build made outside a release.
ARG BELAY_VERSION=dev
RUN BELAY_VERSION=$BELAY_VERSION pnpm --filter @belay/web build && pnpm --filter @belay/server build

# The server is one esbuild bundle: no node_modules in the final image.
FROM mirror.gcr.io/library/node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WEB_DIST=public MIGRATIONS_DIR=drizzle
COPY --from=build /src/apps/server/dist/main.js ./main.js
# The operator's command: docker compose exec app node admin.js <rebind|delete> ...
COPY --from=build /src/apps/server/dist/admin.js ./admin.js
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "main.js"]
