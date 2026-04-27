#!/usr/bin/env bash
#
# Build a WordPress-installable plugin zip from HEAD.
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

built=(
	"assets/js/desktop.js"
	"assets/js/desktop.min.js"
	"assets/js/iframe-bridge.js"
	"assets/js/iframe-bridge.min.js"
	"assets/js/code-editor.js"
	"assets/js/code-editor.min.js"
)

for file in "${built[@]}"; do
	if [[ ! -f "$file" ]]; then
		echo "error: $file is missing — run 'npm run build' first." >&2
		exit 1
	fi
done

git archive --worktree-attributes --prefix="$prefix/" HEAD | tar -x -C "$tmp"

for file in "${built[@]}"; do
	cp "$file" "$tmp/$prefix/$file"
done

( cd "$tmp" && zip -qr "$root/$out" "$prefix" )

echo "Wrote $out"
