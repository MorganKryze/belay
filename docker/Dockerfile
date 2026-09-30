# Pinned by digest and read through mirror.gcr.io (same object as Docker Hub,
# without the anonymous rate limit). Dependabot moves tag and digest together.
# The build stage runs on the builder's own architecture: the esbuild bundle and the
# vite dist are the same for every target, and the final stage has no RUN, so a
# multi-arch build never emulates the install or the build.
FROM --platform=$BUILDPLATFORM mirror.gcr.io/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS build
WORKDIR /src
# ponytail: pnpm is fetched without an integrity hash (no +sha512 in packageManager).
# Node 25+ drops corepack: a base bump to a newer major must switch to a pinned
# `npm i -g pnpm@<version>` here.
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @belay/web build && pnpm --filter @belay/server build

# The server is one esbuild bundle: no node_modules in the final image.
FROM mirror.gcr.io/library/node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
ENV NODE_ENV=production PORT=3000 WEB_DIST=public MIGRATIONS_DIR=drizzle
COPY --from=build /src/apps/server/dist/main.js ./main.js
COPY --from=build /src/apps/server/drizzle ./drizzle
COPY --from=build /src/apps/web/dist ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "main.js"]
