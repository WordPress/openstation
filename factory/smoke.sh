#!/usr/bin/env bash
# The gate's real-site check: on the job's own site, with the shell on,
# wp-admin loads in a headless browser and the shell boots, with no PHP error
# from the plugin in debug.log and no JavaScript error on the page.
#
# Runs from the job's worktree with FACTORY_PORT set (checks.sh calls it).
# Starts the worktree's QA instance on that port if it isn't up, and leaves it
# running for the job's agents. Needs the `agent-browser` CLI.
set -euo pipefail

port="${FACTORY_PORT:?FACTORY_PORT must be the port of the job}"
url="http://localhost:$port"
session="factory-smoke-$port"
out=".scratch/smoke"

wp() { npx wp-env run cli wp "$@" 2>/dev/null; }
ab() { agent-browser --session "$session" "$@"; }

mkdir -p "$out"
WP_ENV_PORT="$port" npm run env:start
wp config set WP_DEBUG_LOG true --raw >/dev/null
wp user meta update admin desktop_mode_mode 1 >/dev/null
wp eval 'file_put_contents( WP_CONTENT_DIR . "/debug.log", "" );'

trap 'ab close >/dev/null 2>&1 || true' EXIT
ab open "$url/wp-login.php" >/dev/null
ab fill '#user_login' admin >/dev/null
ab fill '#user_pass' password >/dev/null
ab click '#wp-submit' >/dev/null
ab wait --url '**/wp-admin/**' >/dev/null
ab errors --clear >/dev/null
ab console --clear >/dev/null

ab open "$url/wp-admin/" >/dev/null
status=0
if ! ab wait --fn "!! ( window.wp && window.wp.os && document.querySelector( '#os-shell .os-dock' ) )" >/dev/null; then
	echo "smoke: the shell never booted on $url/wp-admin/" >&2
	status=1
fi
ab screenshot "$out/wp-admin.png" >/dev/null || true

ab errors --json > "$out/errors.json"
ab console --json > "$out/console.json"
wp eval 'echo file_get_contents( WP_CONTENT_DIR . "/debug.log" );' > "$out/debug.log"

errors=$( jq -r '.data.errors[]? | .message // .text // tostring' "$out/errors.json" )
console=$( jq -r '.data.messages[]? | select( .type == "error" ) | .text' "$out/console.json" )
php=$( grep -E 'PHP (Fatal|Parse|Recoverable)|PHP [A-Za-z ]+:.*/plugins/desktop-mode/' "$out/debug.log" || true )

if [ -n "$errors" ]; then echo "smoke: JavaScript errors on wp-admin:" >&2; echo "$errors" >&2; status=1; fi
if [ -n "$console" ]; then echo "smoke: console errors on wp-admin:" >&2; echo "$console" >&2; status=1; fi
if [ -n "$php" ]; then echo "smoke: PHP errors in debug.log:" >&2; echo "$php" >&2; status=1; fi

[ "$status" = 0 ] && echo "smoke: the shell booted on $url/wp-admin/ with no PHP or JavaScript errors."
exit "$status"
