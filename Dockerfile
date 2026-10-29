# syntax=docker/dockerfile:1

# The build runs on the builder's own architecture: esbuild and rollup are native binaries that
# crash (SIGILL, exit 132) under QEMU. Only JavaScript comes out of it, so it is the same for every
# target; the one thing that depends on the target (better-sqlite3's prebuild) is picked by
# TARGETARCH below.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
ARG TARGETARCH
RUN corepack enable
WORKDIR /app
COPY . .
# Install scripts are skipped (here and in `deploy`): better-sqlite3 would compile itself with
# node-gyp, but it ships a prebuilt binary for musl (x64 and arm64) that it loads instead.
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build && pnpm build:web

# One self-contained dependency tree for the server, the CLI and the web UI, without dev tooling.
RUN pnpm --filter @kinoshelf/image deploy --prod --legacy --ignore-scripts /out

# Trim what the runtime never reads. Licenses stay: the dependencies' terms require them.
RUN set -eu; \
    arch="$(echo "$TARGETARCH" | sed 's/amd64/x64/')"; \
    sqlite="$(ls -d /out/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3)"; \
    # better-sqlite3 ships a binary per platform and the SQLite sources: only ours is loaded.
    find "$sqlite/prebuilds" -type f ! -name "linuxmusl-$arch.node" -delete; \
    rm -rf "$sqlite/deps" "$sqlite/src" "$sqlite/build"; \
    # Type declarations, source maps and docs are for development. Docs are matched by their exact
    # names: a looser glob such as `HISTORY*` also deletes our own `history.js`.
    find /out/node_modules \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \
         -o -iname 'README' -o -iname 'README.md' -o -iname 'CHANGELOG' -o -iname 'CHANGELOG.md' \
         -o -iname 'HISTORY' -o -iname 'HISTORY.md' \) -type f -delete

# The node binary of the target platform, without the debug symbols it never uses.
FROM node:22-alpine AS node
RUN apk add --no-cache binutils && strip --strip-unneeded -o /out-node /usr/local/bin/node

# Alpine alone: the node:alpine image adds npm, yarn and corepack, which the runtime does not use.
FROM alpine:3.24
RUN apk add --no-cache libstdc++ su-exec
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint
COPY --from=node /out-node /usr/local/bin/node
COPY --from=build /out /app
# Both commands are on the PATH: `kinoshelf-server api-key create`, `kinoshelf cleanup --apply`…
# They go through the entrypoint, so a `docker exec` (root) does not leave root-owned files in /config.
RUN printf '#!/bin/sh\nexec docker-entrypoint node /app/node_modules/@kinoshelf/server/dist/main.js "$@"\n' > /usr/local/bin/kinoshelf-server \
 && printf '#!/bin/sh\nexec docker-entrypoint node /app/node_modules/@kinoshelf/cli/dist/main.js "$@"\n' > /usr/local/bin/kinoshelf \
 && chmod +x /usr/local/bin/kinoshelf-server /usr/local/bin/kinoshelf
WORKDIR /app
ENV NODE_ENV=production \
    KINOSHELF_CONFIG_DIR=/config
VOLUME /config
EXPOSE 8484
# /health is public. busybox wget is enough: no need to ship curl for this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${KINOSHELF_PORT:-8484}/health" || exit 1
ENTRYPOINT ["docker-entrypoint"]
CMD ["kinoshelf-server"]
