#!/bin/sh
# Runs the command as PUID:PGID (default 1000:1000), the convention of NAS images: the user picks
# the owner of the media folders instead of chown-ing them. Started as another user (`user:` in
# Compose, `--user` with docker run), it does nothing and runs the command as is.
set -eu

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
case "$PUID$PGID" in
  '' | *[!0-9]*)
    echo "PUID and PGID must be numbers (got PUID=$PUID, PGID=$PGID)." >&2
    exit 1
    ;;
esac

# Only /config: the media folders belong to the user and are never touched. A failure (NFS with
# root squash) is not fatal: the server then says what it cannot write.
if ! chown -R "$PUID:$PGID" /config 2>/dev/null; then
  echo "Warning: could not give /config to $PUID:$PGID." >&2
fi

exec su-exec "$PUID:$PGID" "$@"
