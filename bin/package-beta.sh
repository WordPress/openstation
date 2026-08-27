#!/usr/bin/env bash
#
# Build a WordPress-installable zip of the OpenStation Beta companion
# plugin (extensions/openstation-beta/). Unlike the main plugin there is
# no build
# step — everything the companion ships is tracked in git — so this is
# a plain `git archive` of the subtree, round-tripped through tar + zip
# for the same permission-normalisation reason documented in
# bin/package.sh (git's zip output stores 0600/0700 modes the WP
# installer chokes on).

set -euo pipefail

prefix="openstation-beta"
srcpath="extensions/$prefix"
out="${1:-$prefix.zip}"
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! git cat-file -e "HEAD:$srcpath" 2>/dev/null; then
	echo "error: '$srcpath/' not present in HEAD." >&2
	exit 1
fi

git archive --worktree-attributes --prefix="$prefix/" "HEAD:$srcpath" | tar -x -C "$tmp"

rm -f "$root/$out"
( cd "$tmp" && zip -qr "$root/$out" "$prefix" )

echo "Wrote $out"
