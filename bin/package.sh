#!/usr/bin/env bash
#
# Build a WordPress-installable plugin zip from HEAD.
#
# Allow-list packaging: only the paths listed in `include` below ship.
# Anything else committed to the repo (build config, tests, dev tooling,
# stray editor recordings, etc.) is excluded by default. To ship a new
# top-level directory or file, add it here intentionally — accidental
# commits at the repo root never end up in a release.
#
# Why not `git archive --format=zip` directly? Git's zip output stores
# Unix mode 0600 for files / 0700 for dirs — after extraction by the WP
# plugin installer, those files are unreadable by the web-server user.
# Round-tripping through `tar` + `zip` lands the entries at the tools'
# defaults (0644 / 0755), which is what WordPress expects.
#
# Vite build output is gitignored, so `git archive` skips it. We splice
# those files in from the working tree after extraction. Run `npm run
# build` first — this script packages, it does not build.

set -euo pipefail

prefix="desktop-mode"
out="${1:-$prefix.zip}"
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Allow-list: the only top-level paths that ship in the zip.
include=(
	"desktop-mode.php"
	"readme.txt"
	"LICENSE"
	"README.md"
	"assets"
	"includes"
	"languages"
)

# Verify each allow-listed path is actually in HEAD — catches typos and
# files that have been removed from the repo without updating the list.
for path in "${include[@]}"; do
	if ! git cat-file -e "HEAD:$path" 2>/dev/null; then
		echo "error: '$path' is in the package allow-list but not present in HEAD." >&2
		echo "       Update the 'include' array in bin/package.sh." >&2
		exit 1
	fi
done

# Vite build output: every gitignored .js under assets/js/. Listed by
# `git ls-files --others --ignored --exclude-standard`, which only
# returns files that exist on disk — so a missing build is detected as
# "no files found", not as a stale hard-coded list. Adding a new bundle
# in vite.config.js does not require updating this script.
mapfile -t built < <(git ls-files --others --ignored --exclude-standard -- 'assets/js/*.js')

if (( ${#built[@]} == 0 )); then
	echo "error: no built JS found under assets/js/ — run 'npm run build' first." >&2
	exit 1
fi

git archive --worktree-attributes --prefix="$prefix/" HEAD -- "${include[@]}" | tar -x -C "$tmp"

for file in "${built[@]}"; do
	cp "$file" "$tmp/$prefix/$file"
done

( cd "$tmp" && zip -qr "$root/$out" "$prefix" )

echo "Wrote $out"
