#!/usr/bin/env bash
#
# Mirror the working tree into a sibling wordpress-develop checkout by
# copying files (no symlinks — the target environment doesn't follow
# them reliably).
#
# Watch loop: fswatch monitors the *source* inputs (TS under src/, CSS,
# PHP, etc.) and on every change runs `npm run build` followed by an
# rsync of the include set. The built bundles under assets/js/ are
# rsynced but NOT watched — that's how we avoid an infinite build loop.
#
# Include list lives in bin/sync-to-wp-develop.includes — only paths
# listed there are copied to the destination.
#
# Usage:
#   bin/sync-to-wp-develop.sh           # build + one-shot rsync
#   bin/sync-to-wp-develop.sh --watch   # initial build+sync + fswatch loop

set -euo pipefail

# Source root = directory containing this script's parent (bin/..). Using
# BASH_SOURCE so the resolution works regardless of symlinks, $PWD, or
# how the script was invoked — handy when running from a git worktree.
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
src=$(cd "$script_dir/.." && pwd -P)
includes_file="$script_dir/sync-to-wp-develop.includes"

# Destination resolution order (first hit wins):
#
#   1. `WPDM_SYNC_DEST=/path/to/plugin` env var. Use verbatim. Lets a
#      developer pin a specific worktree regardless of what Docker
#      thinks.
#   2. Auto-detect from a running Docker container: look for any
#      container with a mount whose Destination is exactly `/var/www`
#      (the wordpress-develop docker-compose convention — wp-env uses
#      `/var/www/html` so it's automatically excluded), and verify
#      the host-side Source has a `src/wp-content/plugins/` directory.
#      Append `desktop-mode` to land at the plugin folder.
#   3. Fallback: `$HOME/github/wordpress-develop/src/wp-content/plugins/desktop-mode`.
#      Preserves the historical default for the case where Docker
#      isn't running yet but the checkout is in the canonical place.
#
# Goal: another developer with their wordpress-develop checkout at
# `~/repos/wordpress-develop` (or anywhere else) gets the right
# destination as long as their dev container is up. No PR-tracked
# config or per-developer overrides required.
default_dest_via_docker() {
	command -v docker >/dev/null 2>&1 || return 1
	docker info >/dev/null 2>&1 || return 1

	local cid host_src
	while IFS= read -r cid; do
		[[ -z "$cid" ]] && continue
		host_src=$(docker inspect --format \
			'{{range .Mounts}}{{if eq .Destination "/var/www"}}{{println .Source}}{{end}}{{end}}' \
			"$cid" 2>/dev/null | head -n1)
		[[ -n "$host_src" ]] || continue
		# Sanity-check: the source path should look like a wordpress-
		# develop checkout (has `src/wp-content/plugins/` and the
		# WP test config sample). Both `wordpress-develop-*` services
		# (cli, php, nginx, mysql) match — we pick whichever one
		# `docker ps` returns first.
		if [[ -d "$host_src/src/wp-content/plugins" && -f "$host_src/wp-tests-config-sample.php" ]]; then
			printf '%s\n' "$host_src/src/wp-content/plugins/desktop-mode"
			return 0
		fi
	done < <(docker ps --format '{{.ID}}')
	return 1
}

if [[ -n "${WPDM_SYNC_DEST:-}" ]]; then
	dest="$WPDM_SYNC_DEST"
	echo "[sync] dest from WPDM_SYNC_DEST: $dest"
elif dest_auto=$(default_dest_via_docker); then
	dest="$dest_auto"
	echo "[sync] dest auto-detected from running container: $dest"
else
	dest="$HOME/github/wordpress-develop/src/wp-content/plugins/desktop-mode"
	echo "[sync] dest fallback default: $dest"
	echo "[sync]   (no running wordpress-develop container found —"
	echo "[sync]    set WPDM_SYNC_DEST to override, or start the container)"
fi

parent_plugins_dir=$(dirname "$dest")
if [[ ! -d "$parent_plugins_dir" ]]; then
	echo "error: $parent_plugins_dir not found." >&2
	echo "       Set WPDM_SYNC_DEST to the destination plugin path if it lives elsewhere." >&2
	exit 1
fi

if [[ -L "$dest" ]]; then
	echo "error: $dest is a symlink. Remove it first so rsync can populate a real directory." >&2
	exit 1
fi

# Sync set: everything in the include list (assets/js/ included — it's
# build output that needs to ship).
includes=()
while IFS= read -r line; do
	line="${line%%#*}"
	line="${line//[[:space:]]/}"
	[[ -z "$line" ]] && continue
	includes+=("$line")
done < "$includes_file"

# Watch set: same as include set, but `assets` is expanded to its
# non-build subdirs so we don't observe our own writes to assets/js/
# and assets/vendor/. Add src/ explicitly — TS sources drive the build
# but don't ship.
#
# extensions/ is intentionally NOT in the include list (or watched).
# Each extension is its own WordPress plugin distributed independently
# via GitHub Releases — installed by the user separately, never as part
# of the parent plugin. Mirroring them into the parent's plugin folder
# would shadow whatever standalone copy the user installed and produce
# stale state when both diverge.
watch_paths=()
for name in "${includes[@]}"; do
	if [[ "$name" == "assets" ]]; then
		# Skip assets/js (Vite output) and assets/vendor (vendor:pixi
		# build copy) — both are build output and watching them would
		# loop us when `npm run build` runs.
		for sub in css images; do
			[[ -d "$src/assets/$sub" ]] && watch_paths+=("$src/assets/$sub")
		done
	else
		[[ -e "$src/$name" ]] && watch_paths+=("$src/$name")
	fi
done
[[ -d "$src/src" ]] && watch_paths+=("$src/src")

mkdir -p "$dest"

build_and_sync() {
	echo "[sync] $(date '+%H:%M:%S') npm run build"
	( cd "$src" && npm run build )

	for name in "${includes[@]}"; do
		[[ -e "$src/$name" ]] || continue
		if [[ -d "$src/$name" ]]; then
			rsync -a --delete "$src/$name/" "$dest/$name/"
		else
			rsync -a "$src/$name" "$dest/$name"
		fi
	done

	# Drop top-level entries in dest that are no longer in the include list.
	for entry in "$dest"/* "$dest"/.[!.]*; do
		[[ -e "$entry" ]] || continue
		name=$(basename "$entry")
		keep=0
		for want in "${includes[@]}"; do
			[[ "$name" == "$want" ]] && { keep=1; break; }
		done
		(( keep )) || rm -rf "$entry"
	done

	echo "[sync] $(date '+%H:%M:%S') rsync → $dest"
}

want_watch=0
if [[ "${1:-}" == "--watch" ]]; then
	if command -v fswatch >/dev/null 2>&1; then
		want_watch=1
	else
		echo "[sync] fswatch not installed — running one-shot build+sync only." >&2
		echo "[sync] install fswatch to enable watch mode (brew install fswatch)." >&2
	fi
fi

build_and_sync

(( want_watch )) || exit 0

echo "[sync] watching ${#watch_paths[@]} paths under $src — Ctrl-C to stop"

# fswatch excludes (regex against full path):
# - .DS_Store: Finder noise
# - /node_modules/: huge + chatty
fswatch -o \
	--exclude='\.DS_Store$' \
	--exclude='/node_modules/' \
	--latency 1 \
	"${watch_paths[@]}" | while read -r _; do
	build_and_sync || echo "[sync] build/sync failed — waiting for next change"
done
