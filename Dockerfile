# syntax=docker/dockerfile:1

FROM node:22-alpine AS build
RUN apk add --no-cache binutils && corepack enable
WORKDIR /app
COPY . .
# Install scripts are skipped (here and in `deploy`): better-sqlite3 would compile itself with
# node-gyp, but it ships a prebuilt binary for musl (x64 and arm64) that it loads instead.
RUN pnpm install --frozen-lockfile --ignore-scripts && pnpm build

# One self-contained dependency tree for the server and the CLI, without dev tooling.
RUN pnpm --filter @kinoshelf/image deploy --prod --legacy --ignore-scripts /out

# Trim what the runtime never reads. Licenses stay: the dependencies' terms require them.
RUN set -eu; \
    arch="$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')"; \
    sqlite="$(ls -d /out/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3)"; \
    # better-sqlite3 ships a binary per platform and the SQLite sources: only ours is loaded.
    find "$sqlite/prebuilds" -type f ! -name "linuxmusl-$arch.node" -delete; \
    rm -rf "$sqlite/deps" "$sqlite/src" "$sqlite/build"; \
    # Type declarations, source maps and docs are for development.
    find /out/node_modules \( -name '*.d.ts' -o -name '*.d.cts' -o -name '*.d.mts' -o -name '*.map' \
         -o -iname 'README*' -o -iname 'CHANGELOG*' -o -iname 'HISTORY*' \) -type f -delete; \
    # The node binary carries debug symbols it never uses.
    strip --strip-unneeded -o /out-node /usr/local/bin/node

# Alpine alone: the node:alpine image adds npm, yarn and corepack, which the runtime does not use.
FROM alpine:3.24
RUN apk add --no-cache libstdc++ \
 && addgroup -g 1000 node && adduser -u 1000 -G node -s /bin/sh -D node
COPY --from=build /out-node /usr/local/bin/node
COPY --from=build /out /app
# Both commands are on the PATH: `kinoshelf-server api-key create`, `kinoshelf cleanup --apply`…
RUN printf '#!/bin/sh\nexec node /app/node_modules/@kinoshelf/server/dist/main.js "$@"\n' > /usr/local/bin/kinoshelf-server \
 && printf '#!/bin/sh\nexec node /app/node_modules/@kinoshelf/cli/dist/main.js "$@"\n' > /usr/local/bin/kinoshelf \
 && chmod +x /usr/local/bin/kinoshelf-server /usr/local/bin/kinoshelf
WORKDIR /app
ENV NODE_ENV=production \
    KINOSHELF_CONFIG_DIR=/config
VOLUME /config
EXPOSE 8484
USER node
CMD ["kinoshelf-server"]
