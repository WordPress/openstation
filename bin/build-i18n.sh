#!/usr/bin/env bash
#
# Build per-handle JSON translation files from PO files.
#
# WordPress's `wp_set_script_translations( $handle, $domain, $path )` expects
# `$path/$domain-$locale-$handle.json`. `wp i18n make-json` only emits one
# JSON per JS source file (named with the md5 of the source path), which
# does not match the lookup performed when a translations path is passed.
#
# This script:
#   1. Runs `wp i18n make-json --extensions=ts` on every PO file in
#      languages/ into a temporary directory, producing one hashed JSON
#      per .ts source file.
#   2. Merges those hashed JSONs per handle, based on a source-prefix to
#      handle map defined below, and writes them as
#      `languages/$domain-$locale-$handle.json` so WordPress can find them.
#
# Re-run this whenever the .po files change. PO/POT extraction itself is
# not handled here, that is normally done via `wp i18n make-pot` against
# the plugin root (with `--include='src/*.ts'` appended manually if you
# want JS strings in the POT).

set -euo pipefail

DOMAIN="desktop-mode"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANG_DIR="$PLUGIN_DIR/languages"

if ! command -v wp >/dev/null 2>&1; then
	echo "build-i18n.sh: wp-cli is required (https://wp-cli.org/)." >&2
	exit 1
fi

if ! command -v php >/dev/null 2>&1; then
	echo "build-i18n.sh: php is required." >&2
	exit 1
fi

# Source-prefix to script-handle map.
#
# Every script handle that is wired up via `wp_set_script_translations()`
# in includes/assets.php must have an entry here. A PO `#:` reference
# whose path starts with one of these prefixes is bundled into the
# matching handle's JSON. A reference that matches no prefix is dropped
# (PHP-only strings live in the .mo file, not the JSON).
#
# Order matters: the first matching prefix wins, so list the most
# specific paths first.
declare -a HANDLE_MAP=(
	# The Trash app's client view (its companion-script handle, from
	# includes/framework/wordpress.php). The shared renderers under
	# src/recycle-bin/ ride whichever bundle imports them, so their
	# strings map to the app handle too — first match wins.
	"apps/trash/=openstation-app-desktop-mode-recycle-bin-client"
	"src/recycle-bin/=openstation-app-desktop-mode-recycle-bin-client"
	"src/posts-window/=os-posts-window"
	"src/=openstation"
)

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

shopt -s nullglob
po_files=("$LANG_DIR"/${DOMAIN}-*.po)
shopt -u nullglob

if [ "${#po_files[@]}" -eq 0 ]; then
	echo "build-i18n.sh: no PO files found in $LANG_DIR." >&2
	exit 0
fi

for po in "${po_files[@]}"; do
	locale="$(basename "$po" .po)"
	locale="${locale#${DOMAIN}-}"

	out_dir="$tmp_dir/$locale"
	mkdir -p "$out_dir"

	# Extract hashed JSON files (one per .ts source file referenced by
	# the PO). --no-purge keeps the PO untouched.
	wp i18n make-json "$po" "$out_dir" --extensions=ts --no-purge --pretty-print >/dev/null

	# Merge the hashed JSONs into one per-handle JSON, written into
	# languages/ with the filename WordPress actually looks for. We
	# pass each handle the list of MORE-specific prefixes that come
	# before it in HANDLE_MAP, so a catch-all entry like `src/=...`
	# does not also pull in strings already claimed by a narrower
	# prefix like `src/recycle-bin/=...`.
	previous_prefixes=""
	for entry in "${HANDLE_MAP[@]}"; do
		prefix="${entry%%=*}"
		handle="${entry#*=}"

		HANDLE_MAP_PREFIX="$prefix" \
		HANDLE_OUT_FILE="$LANG_DIR/${DOMAIN}-${locale}-${handle}.json" \
		HANDLE_SOURCES_DIR="$out_dir" \
		HANDLE_LOCALE="$locale" \
		HANDLE_DOMAIN="$DOMAIN" \
		HANDLE_EXCLUDE_PREFIXES="$previous_prefixes" \
			php "$PLUGIN_DIR/bin/build-i18n-merge.php"

		previous_prefixes="${previous_prefixes}${prefix}"$'\n'
	done
done

echo "build-i18n.sh: regenerated per-handle JSON files in $LANG_DIR."
