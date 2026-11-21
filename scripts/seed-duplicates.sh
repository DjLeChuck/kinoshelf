#!/usr/bin/env bash
# Builds a small world to try "Already in the library" by hand: two libraries that already hold
# a few works, and a downloads folder with one file for each case. Plain bytes, no video: the
# matcher only reads names, and the sizes are what the detection compares.
#
#   make seed-duplicates            # then follow what it prints
#
# Idempotent: what exists is left alone. KINOSHELF_WORK moves it (default: <repo>/.work).
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
base="${KINOSHELF_WORK:-$root/.work}/seed-duplicates"
films="$base/library/films"
shows="$base/library/series"
downloads="$base/downloads"
config="$base/config"

# `put <path> <content>`: a file whose size is its content's, created once.
put() {
  [ -e "$1" ] || { mkdir -p "$(dirname "$1")"; printf '%s' "$2" >"$1"; }
}

dune="$films/Dune (2021) {tmdb-438631}/Dune (2021) {tmdb-438631}.mkv"
alien="$films/Alien (1979) {tmdb-348}/Alien (1979) {tmdb-348}.mkv"
matrix="$films/The Matrix (1999) {tmdb-603}/The Matrix (1999) {tmdb-603}.mkv"
ep1="$shows/Severance (2022) {tmdb-95396}/Season 01/Severance (2022) - s01e01.mkv"
ep2="$shows/Severance (2022) {tmdb-95396}/Season 01/Severance (2022) - s01e02.mkv"

# What the libraries hold already.
put "$dune" "Dune as the library has it"
put "$alien" "Alien as the library has it, a bit longer"
put "$matrix" "The Matrix in 1080p as the library has it, still longer"
put "$ep1" "Severance episode one"
put "$ep2" "Severance episode two, a little longer"

# One download for each case.
# same-file: a hard link of the library's file under another name.
[ -e "$downloads/Dune.2021.1080p-HARDLINK.mkv" ] || {
  mkdir -p "$downloads"
  ln "$dune" "$downloads/Dune.2021.1080p-HARDLINK.mkv"
}
# same-size: a copy, another inode.
put "$downloads/Alien.1979.1080p-COPY.mkv" "Alien as the library has it, a bit longer"
# other-version: the work is there, in a file of another size.
put "$downloads/The.Matrix.1999.2160p-OTHERVERSION.mkv" "The Matrix remuxed in 2160p, far bigger than the 1080p one"
# nothing in the library: stays ready (or to validate).
put "$downloads/Blade.Runner.2049.2017.1080p-NEW.mkv" "Blade Runner 2049, not in the library"
# A whole release already there: every episode is a copy.
put "$downloads/Severance.S01.1080p-WHOLE/Severance.S01E01.1080p.mkv" "Severance episode one"
put "$downloads/Severance.S01.1080p-WHOLE/Severance.S01E02.1080p.mkv" "Severance episode two, a little longer"
# A partial release: two episodes are there, the third is new.
put "$downloads/Severance.S01.2160p-PARTIAL/Severance.S01E01.2160p.mkv" "Severance episode one"
put "$downloads/Severance.S01.2160p-PARTIAL/Severance.S01E02.2160p.mkv" "Severance episode two, a little longer"
put "$downloads/Severance.S01.2160p-PARTIAL/Severance.S01E03.2160p.mkv" "Severance episode three, not in the library"

mkdir -p "$config"
[ -e "$config/config.yaml" ] || cat >"$config/config.yaml" <<YAML
naming: with-id
metadata: none
libraries:
  - id: films
    name: Films
    type: movie
    source: $films
  - id: series
    name: Series
    type: series
    source: $shows
  - id: downloads
    name: Downloads
    into:
      movie: films
      series: series
    source: $downloads
YAML

cat <<TEXT
Seed ready in $base

Start the server on it (a TMDB key is needed, TMDB_API_KEY in .env):

  KINOSHELF_CONFIG_DIR=$config KINOSHELF_API_KEY=<at least 32 characters> make dev-server

Then, in this order (the detection reads what the libraries hold):

  1. Libraries > Films > scan, then Libraries > Series > scan
  2. Arrivals > "Analyse everything again" (or scan the Downloads folder)

What you should see:

  Already in the library   Dune ...HARDLINK (same file), Alien ...COPY (same size),
                           Severance S01 ...WHOLE (every episode is there)
  To validate              The Matrix ...OTHERVERSION (a second version, with the reason)
  Ready (or to validate)   Blade Runner 2049 ...NEW, Severance ...PARTIAL with its panel listing
                           the two episodes already there and "Ignore the 2 files already there"

Start over with: rm -r $base
TEXT
