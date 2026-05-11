#!/usr/bin/env bash
#
# Extract translatable strings from PHP + TypeScript sources into
# languages/desktop-mode.pot, then merge the refreshed POT into every
# existing per-locale PO file via msgmerge.
#
# This script is the "step 1" of the i18n pipeline. The full chain is:
#
#   bin/extract-i18n.sh   -> regenerates languages/desktop-mode.pot
#                            and updates languages/desktop-mode-<locale>.po
#   (translate the .po files in your editor / GlotPress / etc.)
#   bin/build-i18n.sh     -> compiles each .po into per-handle JSON files
#                            that wp_set_script_translations() can load
#
# Re-run this whenever PHP or TypeScript source strings change.
#
# Why two extractors:
#
#   wp-cli's `i18n make-pot` (as of 2.12.0) hardcodes the JS extractor
#   to `['extensions' => ['js', 'jsx']]` in JsCodeExtractor / MakePotCommand,
#   so it physically cannot parse `.ts` / `.tsx` source even with
#   `--include='src/*.ts'`. To pick up TypeScript callers of __(), _x(),
#   etc., we use Automattic's Babel-based extractor
#   `@automattic/wp-babel-makepot` for the JS/TS half, then ask wp-cli's
#   make-pot to merge the resulting JS POT into the PHP-only extraction.
#   This mirrors the approach used in Automattic/studio (fastlane lane
#   `generate_pot_file`).

set -euo pipefail

DOMAIN="desktop-mode"
PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LANG_DIR="$PLUGIN_DIR/languages"
POT_FILE="$LANG_DIR/${DOMAIN}.pot"

if ! command -v wp >/dev/null 2>&1; then
	echo "extract-i18n.sh: wp-cli is required (https://wp-cli.org/)." >&2
	exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
	echo "extract-i18n.sh: npx (Node.js) is required." >&2
	exit 1
fi

mkdir -p "$LANG_DIR"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

js_pot="$tmp_dir/desktop-mode-js.pot"
js_segments="$tmp_dir/js-segments"

# 1. Extract JS/TS strings via Automattic's Babel-based extractor.
#    Run from inside PLUGIN_DIR so source-line `#:` references in the
#    POT are written relative to the plugin root, matching the layout
#    of the PHP refs we'll merge with in step 2.
(
	cd "$PLUGIN_DIR"
	npx --no-install @automattic/wp-babel-makepot \
		"src/**/*.{js,jsx,ts,tsx}" \
		--ignore "**/*.d.ts,**/*.test.ts,**/*.test.tsx,**/node_modules/**" \
		--base "$PLUGIN_DIR" \
		--dir "$js_segments" \
		--output "$js_pot"
)

# 2. Extract PHP strings via wp-cli, merging in the JS POT from step 1.
#    --skip-js prevents wp-cli from also scanning .js/.jsx (we already
#    have those from babel). The exclude list keeps build output,
#    third-party code, sibling plugins, and tests out of the result.
EXCLUDE_PATHS=(
	"assets/js"
	"dist"
	"node_modules"
	"vendor"
	"packages"
	"extensions"
	"desktop-mode-code-editor"
	"tests"
	"bin"
)
EXCLUDE_CSV="$(IFS=,; echo "${EXCLUDE_PATHS[*]}")"

wp i18n make-pot "$PLUGIN_DIR" "$POT_FILE" \
	--slug="$DOMAIN" \
	--domain="$DOMAIN" \
	--skip-js \
	--exclude="$EXCLUDE_CSV" \
	--merge="$js_pot" \
	--headers='{"Report-Msgid-Bugs-To":"https://wordpress.org/support/plugin/alcazaba-plugin"}' \
	>/dev/null

echo "extract-i18n.sh: wrote $POT_FILE"

# 3. Refresh each existing PO against the new POT. We do not create new
#    PO files here, locales are added by hand (or via GlotPress export).
if ! command -v msgmerge >/dev/null 2>&1; then
	echo "extract-i18n.sh: msgmerge not found, skipping PO refresh." >&2
	echo "                 Install gettext (e.g. 'brew install gettext') to enable this step." >&2
	exit 0
fi

shopt -s nullglob
po_files=("$LANG_DIR"/${DOMAIN}-*.po)
shopt -u nullglob

if [ "${#po_files[@]}" -eq 0 ]; then
	echo "extract-i18n.sh: no PO files in $LANG_DIR, skipping msgmerge."
	exit 0
fi

for po in "${po_files[@]}"; do
	msgmerge --update --backup=none --quiet "$po" "$POT_FILE"
	echo "extract-i18n.sh: merged $POT_FILE into $(basename "$po")"
done
