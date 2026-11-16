#!/usr/bin/env bash
# Prints the CHANGELOG.md section of a version (`1.0.0`): the release notes. A pre-release
# (`1.1.0-rc.1`) takes its final version's section, so the notes can be written before the tag.
set -euo pipefail

version="${1:?usage: changelog-section.sh <version>}"
base="${version%%-*}"
cd "$(dirname "$0")/.."

section="$(awk -v v="$base" '
  /^## / { printing = (index($0, "## [" v "]") == 1) ; next }
  printing { print }
' CHANGELOG.md)"

if [ -z "${section//[[:space:]]/}" ]; then
  echo "CHANGELOG.md has no section for $base" >&2
  exit 1
fi
printf '%s\n' "$section"
