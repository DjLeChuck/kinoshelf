#!/usr/bin/env sh
# Builds the small `ffprobe` shipped with the standalone binary: FFmpeg's own, with only the
# demuxers and parsers Kinoshelf reads (see packages/server/src/probe.ts), linked statically.
# LGPL 2.1 or later: no GPL or non-free part, so it may sit beside a MIT program as long as the
# licence and the way to rebuild it go with it, which this script writes next to the result.
#
#   scripts/build-ffprobe.sh <output-dir> [<work-dir>]
#
# Writes <output-dir>/ffprobe and <output-dir>/LICENSES/ffmpeg/. The work directory (default
# .work/ffprobe) keeps the download between runs. Needs a C compiler, make, curl, xz and, for a
# static glibc build, libc.a (`nix develop .#ffprobe` brings all of it; so does musl-gcc).
set -eu

# To change the version, never copy a hash from a page: authenticate the tarball, then pin its hash.
#   curl -fsSLO https://ffmpeg.org/releases/ffmpeg-<version>.tar.xz{,.asc}
#   curl -fsSL https://ffmpeg.org/ffmpeg-devel.asc | gpg --import
#   gpg --verify ffmpeg-<version>.tar.xz.asc ffmpeg-<version>.tar.xz   # "Good signature", and the
#   # primary key must be FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8 (FFmpeg release signing key)
#   sha256sum ffmpeg-<version>.tar.xz                                  # the value below
# The script itself only checks the hash: the signature was checked once, on that very file.
FFMPEG_VERSION=9.0.2
FFMPEG_SHA256=8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz"

[ $# -ge 1 ] || { echo "usage: $0 <output-dir> [<work-dir>]" >&2; exit 2; }
out=$(mkdir -p "$1" && cd "$1" && pwd)
work=$(mkdir -p "${2:-.work/ffprobe}" && cd "${2:-.work/ffprobe}" && pwd)
tarball="$work/ffmpeg-$FFMPEG_VERSION.tar.xz"
src="$work/ffmpeg-$FFMPEG_VERSION"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

[ -f "$tarball" ] || curl -fsSL -o "$tarball" "$FFMPEG_URL"
if [ "$(sha256 "$tarball")" != "$FFMPEG_SHA256" ]; then
  echo "error: $tarball does not match the pinned SHA-256" >&2
  rm -f "$tarball"
  exit 1
fi
rm -rf "$src"
tar -xJf "$tarball" -C "$work"

# macOS cannot link statically; the result still depends on system libraries only.
static=-static
[ "$(uname -s)" = Darwin ] && static=

cd "$src"
# The decoders are there for the HDR: the transfer curve (HDR10, HLG) and HDR10+'s per-frame
# metadata come from the codec's headers and first frame, not from the container. Without them
# ffprobe prints no frame and the curve of an HEVC stream, so every HDR file would read as SDR.
# x86asm off: the parsers and demuxers here have no assembly worth a build dependency (nasm).
# shellcheck disable=SC2086
./configure \
  --disable-everything --disable-autodetect --disable-network --disable-doc --disable-x86asm \
  --disable-ffmpeg --disable-ffplay --enable-ffprobe \
  --disable-avdevice --disable-swscale --disable-swresample --disable-avfilter --enable-small \
  --enable-protocol=file,pipe \
  --enable-decoder=h264,hevc,vp9,av1 \
  --enable-demuxer=matroska,mov,avi,mpegts,mpegps,asf,flv,ogg,m4v,h264,hevc,mpegvideo \
  --enable-parser=h264,hevc,av1,vp9,vp8,mpeg4video,mpegvideo,vc1,aac,aac_latm,ac3,dca,mpegaudio,opus,vorbis,flac \
  ${static:+--extra-ldflags=$static}

jobs=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 2)
make -j"$jobs" ffprobe
strip ffprobe

# Whatever the flags above become, a build that turned GPL or non-free must not ship.
if ./ffprobe -version | grep -Eq -e '--enable-(gpl|nonfree|version3)'; then
  echo "error: this ffprobe is not LGPL 2.1" >&2
  exit 1
fi
# The text wraps in the middle of the licence's name, hence the single line.
license=$(./ffprobe -L 2>/dev/null | tr '\n' ' ')
case "$license" in
  *'Lesser General Public'*'version 2.1'*) ;;
  *)
    echo "error: ffprobe does not report the LGPL 2.1" >&2
    exit 1
    ;;
esac

mkdir -p "$out/LICENSES/ffmpeg"
cp ffprobe "$out/ffprobe"
cp COPYING.LGPLv2.1 "$out/LICENSES/ffmpeg/COPYING.LGPLv2.1"
cat >"$out/LICENSES/ffmpeg/NOTICE.txt" <<NOTICE
ffprobe, shipped beside Kinoshelf, is FFmpeg $FFMPEG_VERSION (https://ffmpeg.org), licensed under the
GNU Lesser General Public License, version 2.1 or later (COPYING.LGPLv2.1).

It is built, unmodified, from the source at
  $FFMPEG_URL
(SHA-256 $FFMPEG_SHA256)
by scripts/build-ffprobe.sh of the Kinoshelf repository, which holds the exact configuration, so
anyone can rebuild it. Kinoshelf runs it as a separate program and links none of FFmpeg.
NOTICE
echo "ffprobe: $out/ffprobe ($(wc -c <"$out/ffprobe") bytes)"
