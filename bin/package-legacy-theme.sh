#!/usr/bin/env bash
#
# Zip the built-in "Legacy" desktop theme into a distributable that
# can be dropped on OS Settings → Themes like any other theme ZIP.
#
# Legacy is registered from code on every install (see
# includes/desktop-themes/builtin.php), so the site it ships with
# never needs this file — it exists so the theme can be handed to
# someone else, forked, or installed on a site whose OpenStation
# registration has been unhooked.
#
# Written to dist/ by default, or to a directory passed as $1.
#
# The archive is built with `zip` rather than `git archive --format=zip`
# for the same reason bin/package-extensions.sh avoids it: git's zip
# output stores mode 0600, which the WP unzipper carries through and
# the web-server user then cannot read.

set -euo pipefail

cd "$(dirname "$0")/.."
root=$(pwd)

src="assets/desktop-themes/legacy"
slug="desktop-mode-legacy-theme"

if [[ ! -f "$src/theme.json" ]]; then
	echo "error: $src/theme.json not found" >&2
	exit 1
fi

out_dir="${1:-$root/dist}"
mkdir -p "$out_dir"
out_dir=$(cd "$out_dir" && pwd)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# One directory deep inside the archive — the shape "Compress this
# folder" produces, and the shape the installer documents first.
mkdir -p "$tmp/legacy"
cp "$src/theme.json" "$tmp/legacy/theme.json"
cp "$src/preview.svg" "$tmp/legacy/preview.svg"

rm -f "$out_dir/$slug.zip"
( cd "$tmp" && zip -qr "$out_dir/$slug.zip" legacy )

echo "packaged $out_dir/$slug.zip"
