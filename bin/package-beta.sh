#!/usr/bin/env bash
#
# Build a WordPress-installable zip of the OpenStation Beta companion
# plugin (openstation-beta/). Unlike the main plugin there is no build
# step — everything the companion ships is tracked in git — so this is
# a plain `git archive` of the subtree, round-tripped through tar + zip
# for the same permission-normalisation reason documented in
# bin/package.sh (git's zip output stores 0600/0700 modes the WP
# installer chokes on).

set -euo pipefail

prefix="openstation-beta"
out="${1:-$prefix.zip}"
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! git cat-file -e "HEAD:$prefix" 2>/dev/null; then
	echo "error: '$prefix/' not present in HEAD." >&2
	exit 1
fi

git archive --worktree-attributes --prefix="$prefix/" "HEAD:$prefix" | tar -x -C "$tmp"

rm -f "$root/$out"
( cd "$tmp" && zip -qr "$root/$out" "$prefix" )

echo "Wrote $out"
