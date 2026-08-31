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

# The install directory remains `desktop-mode` for WordPress.org upgrade and
# dependent-plugin compatibility. Only the public release artifact is renamed.
prefix="desktop-mode"
out="${1:-openstation.zip}"
root=$(pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Allow-list: the only top-level paths that ship in the zip.
include=(
	"desktop-mode.php"
	"readme.txt"
	"LICENSE"
	"README.md"
	"apps"
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

# Vite build output: derive the expected bundle list from the `fileBase`
# entries in vite.config.js — each target builds `<fileBase>.js` (dev)
# and `<fileBase>.min.js` (prod). Adding a new bundle in vite.config.js
# does not require updating this script, and — unlike splicing whatever
# gitignored .js happens to be on disk — stale bundles left behind by
# other branches can never sneak into a release zip.
#
# Only the MINIFIED bundles ship. The unminified dev builds total
# ~4-5 MB (desktop.js alone is >1 MB) and never load at runtime on a
# release install: `openstation_asset_suffix()` (includes/helpers.php)
# probes for `assets/js/desktop.js` and serves `.min` when the dev
# bundles are absent, so even a SCRIPT_DEBUG site degrades gracefully
# instead of 404ing.
mapfile -t bases < <(sed -n "s/^[[:space:]]*fileBase:[[:space:]]*'\([^']*\)',\{0,1\}[[:space:]]*$/\1/p" vite.config.js)

if (( ${#bases[@]} == 0 )); then
	echo "error: no 'fileBase' entries found in vite.config.js." >&2
	echo "       Has the TARGETS map changed shape? Update bin/package.sh." >&2
	exit 1
fi

built=()
for base in "${bases[@]}"; do
	file="assets/js/$base.min.js"
	if [[ ! -f "$file" ]]; then
		echo "error: expected bundle '$file' not found — run 'npm run build' first." >&2
		exit 1
	fi
	built+=("$file")
done

# Reject gitignored .js under assets/js/ that no vite target produces —
# stale output from another branch would otherwise be unaccounted for.
# Tracked hand-written files (admin-bar.js, media-library-enhanced.js)
# ship via `git archive` and are not listed here. Dev bundles
# (`<base>.js`) are legitimate on-disk build output — expected but
# not shipped.
declare -A expected=()
for file in "${built[@]}"; do
	expected["$file"]=1
done
for base in "${bases[@]}"; do
	expected["assets/js/$base.js"]=1
done
while IFS= read -r file; do
	if [[ -z "${expected[$file]:-}" ]]; then
		echo "error: '$file' is not produced by any vite.config.js target." >&2
		echo "       Stale build output? Remove it ('git clean -fX assets/js/') and re-run." >&2
		exit 1
	fi
done < <(git ls-files --others --ignored --exclude-standard -- 'assets/js/*.js')

git archive --worktree-attributes --prefix="$prefix/" HEAD -- "${include[@]}" | tar -x -C "$tmp"

for file in "${built[@]}"; do
	cp "$file" "$tmp/$prefix/$file"
done

# `zip -r` UPDATES an existing archive in place — entries removed from
# the staging tree (e.g. dev bundles that no longer ship) would survive
# from a previous run. Always start from a fresh file.
rm -f "$root/$out"
( cd "$tmp" && zip -qr "$root/$out" "$prefix" )

echo "Wrote $out"
