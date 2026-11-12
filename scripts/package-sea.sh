#!/usr/bin/env sh
# Packs packages/sea/dist (made by `make sea`) into the release archive:
#
#   kinoshelf-<version>-<target>/
#     kinoshelf  ffprobe  LICENSES/{kinoshelf,node,ffmpeg}/ LICENSES/third-party.txt
#
#   scripts/package-sea.sh <version> [<target>]      e.g. 0.3.0 linux-x64 (default: this machine)
#
# Writes packages/sea/dist/kinoshelf-<version>-<target>.tar.xz and its .sha256. It refuses to pack
# without Node's and FFmpeg's licences: shipping their binaries without them is not allowed.
set -eu

[ $# -ge 1 ] || { echo "usage: $0 <version> [<target>]" >&2; exit 2; }
version=$1
if [ $# -ge 2 ]; then
  target=$2
else
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) target=linux-x64 ;;
    Linux-aarch64 | Linux-arm64) target=linux-arm64 ;;
    Darwin-arm64) target=macos-arm64 ;;
    *) echo "error: no target name for $(uname -s)-$(uname -m): pass one" >&2; exit 2 ;;
  esac
fi

dist=packages/sea/dist
for file in kinoshelf ffprobe LICENSES/third-party.txt LICENSES/node/LICENSE LICENSES/ffmpeg/COPYING.LGPLv2.1 LICENSES/ffmpeg/NOTICE.txt; do
  [ -f "$dist/$file" ] || { echo "error: $dist/$file is missing (make sea)" >&2; exit 1; }
done

name="kinoshelf-$version-$target"
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/$name/LICENSES/kinoshelf"
cp "$dist/kinoshelf" "$dist/ffprobe" "$stage/$name/"
cp "$dist/LICENSES/third-party.txt" "$stage/$name/LICENSES/"
cp -R "$dist/LICENSES/node" "$dist/LICENSES/ffmpeg" "$stage/$name/LICENSES/"
cp LICENSE "$stage/$name/LICENSES/kinoshelf/LICENSE"

archive="$dist/$name.tar.xz"
tar -C "$stage" -cf - "$name" | xz -9 -T0 >"$archive"
if command -v sha256sum >/dev/null 2>&1; then sum=$(sha256sum "$archive"); else sum=$(shasum -a 256 "$archive"); fi
# The name only, so `sha256sum -c` works wherever the two files are downloaded.
echo "${sum%% *}  $name.tar.xz" >"$archive.sha256"
echo "$archive ($(wc -c <"$archive") bytes)"
