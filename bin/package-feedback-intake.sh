#!/usr/bin/env bash
#
# Zip the OpenStation Feedback Intake plugin (`tools/feedback-intake/`)
# for upload to openstation.blog.
#
# Deliberately not part of `bin/package.sh`: that script is the release
# contract for the wp.org plugin, run by four CI workflows that consume
# its one artifact, and the intake never ships to wp.org. This one is
# run by hand, writes `openstation-feedback-intake.zip` at the repo root
# (gitignored by the `/openstation-*.zip` rule), and nothing in CI calls it.
#
# The archive is built from the working tree, not from HEAD, so an
# uncommitted change is what gets uploaded — check `git status` first.

set -euo pipefail

src="tools/feedback-intake"
slug="openstation-feedback-intake"
out="${1:-$slug.zip}"
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ ! -f "$src/$slug.php" ]; then
	echo "error: $src/$slug.php not found; run from the repo root." >&2
	exit 1
fi

# Copy rather than `git archive`: the latter stores 0600/0700 modes,
# which the WP installer extracts as files the web server cannot read.
mkdir -p "$tmp/$slug"
cp -R "$src"/. "$tmp/$slug/"
find "$tmp/$slug" -name .DS_Store -delete
rm -f "$tmp/$slug/.gitignore"

# `zip -r` updates an existing archive in place; start clean.
rm -f "$root/$out"
( cd "$tmp" && zip -qr "$root/$out" "$slug" )

version=$(sed -n 's/^ \* Version:[[:space:]]*\([^[:space:]]*\).*$/\1/p' "$src/$slug.php" | head -n 1)
echo "Wrote $out (version $version)"
