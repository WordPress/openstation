#!/usr/bin/env bash
#
# Run Plugin Check against the BUILT plugin and the Popup Siege extension,
# the way a release would ship them. CI's `plugin-check` job and the software
# factory's gate (factory/checks.sh) both call this, so the flags and the
# ignore list cannot drift between them.
#
# Usage:
#   bin/plugin-check.sh            package, start the instance, check (exit 1 on any error finding)
#   bin/plugin-check.sh destroy    remove the instance (the factory's teardown)
#
# Needs the built bundles (`npm run build`) and `jq`. WP_ENV_PORT picks the
# port, as for any wp-env command; unset, wp-env uses its default.
#
# Everything lives in `.scratch/plugin-check/` (gitignored), which also keys
# the wp-env instance to this checkout. The plugin directories are emptied and
# refilled in place, never deleted: the running containers bind-mount them,
# and a recreated directory would leave them serving the old copy.
#
# Plugin Check is installed with wp-cli rather than from a zip source in the
# config: on Node 24.16.0 a zip source makes `wp-env start` exit 0 before the
# instance is ready (wordpress/plugin-check-action@v1 hit this on CI).
set -euo pipefail

cd "$(dirname "$0")/.."

work=".scratch/plugin-check"
config="$work/wp-env.json"
wp_env=( npx wp-env --config "$config" )

if [ "${1:-}" = "destroy" ]; then
	[ -f "$config" ] && "${wp_env[@]}" destroy --force
	exit 0
fi

mkdir -p "$work/plugin/desktop-mode" "$work/extension/desktop-mode-popup-siege"
find "$work/plugin/desktop-mode" "$work/extension/desktop-mode-popup-siege" -mindepth 1 -delete

bin/package.sh "$work/openstation.zip" >/dev/null
unzip -q -o "$work/openstation.zip" -d "$work/plugin"
bin/package-extensions.sh "$work" desktop-mode-popup-siege >/dev/null
unzip -q -o "$work/desktop-mode-popup-siege.zip" -d "$work/extension"

cat > "$config" <<'JSON'
{
	"core": null,
	"plugins": [],
	"mappings": {
		"wp-content/plugins/desktop-mode": "./plugin/desktop-mode",
		"wp-content/plugins/desktop-mode-popup-siege": "./extension/desktop-mode-popup-siege"
	},
	"testsEnvironment": false
}
JSON

"${wp_env[@]}" start
"${wp_env[@]}" run cli wp plugin install plugin-check --activate

# check <plugin> [extra flags…]: only ERROR-severity findings fail.
# wp-env's spinner writes to stderr; the container command's output is on
# stdout, where Plugin Check prefixes each file's findings with a "FILE: …"
# line, so strip those and slurp the per-file JSON arrays.
check() {
	local plugin="$1" out="$work/$1.json" findings
	shift
	"${wp_env[@]}" run cli wp plugin check "$plugin" --format=json --ignore-warnings "$@" \
		> "$out" 2> "$work/$plugin.stderr.log" || true
	findings=$( { grep '^\[' "$out" || true; } | jq -s 'add // [] | length' 2>/dev/null || echo PARSE_ERROR )
	if [ "$findings" = PARSE_ERROR ]; then
		echo "Plugin Check: could not parse the output for $plugin:" >&2
		cat "$out" "$work/$plugin.stderr.log" >&2
		return 1
	fi
	if [ "$findings" != 0 ]; then
		echo "Plugin Check: $findings error finding(s) in $plugin:" >&2
		{ grep '^\[' "$out" || true; } | jq -s -r 'add // [] | .[] | "  [\(.code)] \(.file // "?"):\(.line // "?") \(.message)"' >&2
		return 1
	fi
	echo "Plugin Check: $plugin passed (no errors)."
}

status=0
# wp_function_not_compatible_with_requires_wp: wp_enqueue_command_palette_assets()
# (WP 6.9) is called behind a function_exists() guard in
# includes/render/assets.php, the correct way to use a newer function while
# keeping the 6.0 minimum. Plugin Check's static rule doesn't credit the guard.
check desktop-mode --ignore-codes=wp_function_not_compatible_with_requires_wp || status=1
check desktop-mode-popup-siege || status=1
exit "$status"
