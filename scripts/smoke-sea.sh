#!/usr/bin/env sh
# Starts the standalone binary of an archive in clean images that hold no Node, and reads a clip
# with its ffprobe: what a user's machine looks like.
#
#   scripts/smoke-sea.sh <archive.tar.xz> [<image>...]     (default: debian:12-slim ubuntu:22.04)
#
# Needs Docker, curl and an ffmpeg to make the clip. The archive must be for this CPU.
set -eu

[ $# -ge 1 ] || { echo "usage: $0 <archive.tar.xz> [<image>...]" >&2; exit 2; }
archive=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
shift
[ $# -ge 1 ] || set -- debian:12-slim ubuntu:22.04

work=$(mktemp -d)
container=
cleanup() {
  [ -z "$container" ] || docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

tar -C "$work" -xJf "$archive"
app=$(find "$work" -mindepth 1 -maxdepth 1 -type d | head -n 1)
mkdir "$work/clips"
ffmpeg -v error -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -c:v mpeg4 "$work/clips/clip.mkv"

port=${SMOKE_PORT:-18585}
fail() { echo "FAIL ($image): $1" >&2; docker logs "$container" 2>&1 | tail -20 >&2; exit 1; }

for image in "$@"; do
  echo "== $image"
  # libatomic1 is the one library Node needs that a minimal image lacks (see the installation
  # docs); the .deb and .rpm declare it. Installed here the way a user would.
  container=$(docker run -d -p "127.0.0.1:$port:8484" \
    -v "$app:/opt/kinoshelf:ro" -v "$work/clips:/clips:ro" \
    "$image" sh -c 'apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends libatomic1 >/dev/null && exec /opt/kinoshelf/kinoshelf serve')

  up=
  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:$port/health" >"$work/health" 2>/dev/null; then up=1; break; fi
    [ "$(docker inspect -f '{{.State.Running}}' "$container")" = true ] || break
    sleep 1
  done
  [ -n "$up" ] || fail "the server did not come up"
  grep -q '"status":"ok"' "$work/health" || fail "/health says $(cat "$work/health")"

  curl -fsS "http://127.0.0.1:$port/" | grep -qi '<title>' || fail "the home page is not the web UI"
  # The image has no Node of its own: what ran is the binary alone.
  if docker exec "$container" sh -c 'command -v node' >/dev/null 2>&1; then fail "this image has a node"; fi
  codec=$(docker exec "$container" /opt/kinoshelf/ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name -of csv=p=0 /clips/clip.mkv) || fail "ffprobe cannot run"
  [ "$codec" = mpeg4 ] || fail "ffprobe read '$codec' instead of mpeg4"

  docker rm -f "$container" >/dev/null
  container=
  echo "ok"
done
