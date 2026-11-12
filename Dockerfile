# syntax=docker/dockerfile:1

# Base images are pinned by the digest of their multi-arch index (a tag can be moved to other
# content); the tag stays for the reader and for Dependabot, which bumps both every week.

# The node binary of the target platform, without the debug symbols it never uses, and its licence
# (the image drops it, the official tarball has it): the standalone binary is this node with the
# application injected, so the licence must travel with it. Laid out as `bin/node` + `LICENSE`, which
# is where `bundle.mjs` looks for it.
FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS node
RUN set -eu; \
    apk add --no-cache binutils; \
    mkdir -p /out/bin; \
    strip --strip-unneeded -o /out/bin/node /usr/local/bin/node; \
    wget -q -O /out/LICENSE "https://raw.githubusercontent.com/nodejs/node/$(node -p process.version)/LICENSE"; \
    [ -s /out/LICENSE ]

# The minimal ffprobe, built for musl on the target platform (a static glibc one would not mind, but
# this one is built where it runs, with the script the archives use). The layer only changes with
# the script, so the build cache keeps it.
FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS ffprobe
RUN apk add --no-cache build-base curl xz binutils
COPY scripts/build-ffprobe.sh /src/build-ffprobe.sh
RUN /src/build-ffprobe.sh /out /work

# The build runs on the builder's own architecture: esbuild and rollup are native binaries that
# crash (SIGILL, exit 132) under QEMU. What comes out of it is JavaScript, so it is the same for every
# target: SQLite is Node's own (`node:sqlite`), no native module depends on the architecture. The
# standalone binary is made by injecting that JavaScript into the target's node (`KINOSHELF_SEA_NODE`),
# which Node does from any platform.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS build
# Node 25 dropped corepack, so pnpm is installed with npm, at the version `packageManager` pins.
WORKDIR /app
COPY package.json ./
RUN npm install -g "pnpm@$(node -p "require('./package.json').packageManager.split('@')[1]")"
COPY . .
# Install scripts are skipped: nothing the runtime needs is built by one.
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build && pnpm build:web
COPY --from=node /out /node
RUN KINOSHELF_SEA_NODE=/node/bin/node pnpm --filter @kinoshelf/sea build

# Alpine alone: the node:alpine image adds npm and yarn, which the runtime does not use. The binary
# is dynamic: it needs the C++ runtime, and `libatomic`, which is not in Alpine's base.
FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
RUN apk add --no-cache libstdc++ libatomic su-exec
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint
# `ffprobe` (a video's codec and audio tracks) goes beside the binary, where it looks for it;
# Kinoshelf never encodes.
COPY --from=build /app/packages/sea/dist/kinoshelf /opt/kinoshelf/kinoshelf
COPY --from=ffprobe /out/ffprobe /opt/kinoshelf/ffprobe
# The licences of what is shipped: Kinoshelf, Node, the npm packages bundled in, FFmpeg.
COPY LICENSE /licenses/kinoshelf/LICENSE
COPY --from=build /app/packages/sea/dist/LICENSES /licenses
COPY --from=ffprobe /out/LICENSES/ffmpeg /licenses/ffmpeg
# Both commands are on the PATH: `kinoshelf api-key create`, `kinoshelf cleanup --apply`…
# They go through the entrypoint, so a `docker exec` (root) does not leave root-owned files in /config.
# `kinoshelf-server` is the name the image always had: alone it starts the server, with arguments
# (`api-key create`, `notify test`) it is the binary's own command.
RUN printf '#!/bin/sh\nexec docker-entrypoint /opt/kinoshelf/kinoshelf "$@"\n' > /usr/local/bin/kinoshelf \
 && printf '#!/bin/sh\n[ $# -gt 0 ] || set -- serve\nexec docker-entrypoint /opt/kinoshelf/kinoshelf "$@"\n' > /usr/local/bin/kinoshelf-server \
 && chmod +x /usr/local/bin/kinoshelf /usr/local/bin/kinoshelf-server
ENV NODE_ENV=production \
    KINOSHELF_CONFIG_DIR=/config
VOLUME /config
EXPOSE 8484
# /health is public. busybox wget is enough: no need to ship curl for this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${KINOSHELF_PORT:-8484}/health" || exit 1
ENTRYPOINT ["docker-entrypoint"]
CMD ["kinoshelf-server"]
