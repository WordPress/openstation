#!/usr/bin/env bash
# The member instance of a local OpenStation network (`.wp-env.member.json`,
# port 8892): a single site with the plugin active, OpenStation on for
# admin, and the dev shim that lets it reach the hub on :8890.
set -euo pipefail

WP_ENV_BIN="${WP_ENV_BIN:-./node_modules/.bin/wp-env}"
CONFIG="--config=.wp-env.member.json"

# `desktop-mode` is the plugin SLUG (frozen; see bin/setup-wp-env.sh).
"${WP_ENV_BIN}" run "${CONFIG}" cli wp plugin activate desktop-mode
"${WP_ENV_BIN}" run "${CONFIG}" cli wp option update blogname "Member site"
"${WP_ENV_BIN}" run "${CONFIG}" cli wp user meta update admin desktop_mode_mode 1

./bin/wp-env-network-dev.sh "${CONFIG}"
