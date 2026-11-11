# syntax=docker/dockerfile:1

# Base images are pinned by the digest of their multi-arch index (a tag can be moved to other
# content); the tag stays for the reader and for Dependabot, which bumps both every week.

# The build runs on the builder's own architecture: esbuild and rollup are native binaries that
# crash (SIGILL, exit 132) under QEMU. Only JavaScript comes out of it, so it is the same for every
# target: SQLite is Node's own (`node:sqlite`), no native module depends on the architecture.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
# Node 25 dropped corepack, so pnpm is installed with npm, at the version `packageManager` pins.
WORKDIR /app
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY . .
# Install scripts are skipped (here and in `deploy`): nothing the runtime needs is built by one.
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build && pnpm build:web

# One self-contained dependency tree for the server, the CLI and the web UI, without dev tooling.
RUN pnpm --filter @kinoshelf/image deploy --prod --legacy --ignore-scripts /out

# Trim what the runtime never reads. Licenses stay: the dependencies' terms require them.
RUN set -eu; \
    # Type declarations, source maps and docs are for development. Docs are matched by their exact
    # names: a looser glob such as `HISTORY*` also deletes our own `history.js`.
    find /out/node_modules \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \
         -o -iname 'README' -o -iname 'README.md' -o -iname 'CHANGELOG' -o -iname 'CHANGELOG.md' \
         -o -iname 'HISTORY' -o -iname 'HISTORY.md' \) -type f -delete

# The node binary of the target platform, without the debug symbols it never uses.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS node
RUN apk add --no-cache binutils && strip --strip-unneeded -o /out-node /usr/local/bin/node

# Alpine alone: the node:alpine image adds npm and yarn, which the runtime does not use.
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a
# `ffmpeg` is there for its `ffprobe` (a video's codec and audio tracks); Kinoshelf never encodes.
# `libatomic` is needed by the node binary (it is not in ffmpeg's dependencies).
RUN apk add --no-cache libstdc++ libatomic su-exec ffmpeg
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
