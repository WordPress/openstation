#!/usr/bin/env bash
# Lets two local wp-env instances pair as an OpenStation network.
#
# Inside a container, `localhost` is the container itself, so the hub
# on :8890 can never reach the member on :8892 by the address the
# browser uses. This drops an mu-plugin into the given instance that
# rewrites the URL an install reaches another by (the
# `openstation_network_request_url` filter, which exists for exactly
# this kind of thing: proxies, internal hostnames) onto Docker's host
# gateway. Dev tooling only; nothing here ships.
#
# Usage: bin/wp-env-network-dev.sh [--config=<wp-env config>]
set -euo pipefail

WP_ENV_BIN="${WP_ENV_BIN:-./node_modules/.bin/wp-env}"
# Find the instance directory. `wp-env install-path` answers on newer
# wp-env; older ones print nothing, so fall back to Docker's own mount
# table: the container publishing the config's port maps /var/www/html
# onto the instance's WordPress directory.
CONFIG_FILE=".wp-env.json"
for arg in "$@"; do
	case "${arg}" in
		--config=*) CONFIG_FILE="${arg#--config=}" ;;
	esac
done
INSTALL_PATH="$("${WP_ENV_BIN}" install-path "$@" 2>/dev/null | grep -m1 '\.wp-env/' | tr -d '[:space:]' || true)"
if [ -z "${INSTALL_PATH}" ]; then
	PORT="$(grep -o '"port":[[:space:]]*[0-9]*' "${CONFIG_FILE}" | grep -o '[0-9]*$')"
	CONTAINER="$(docker ps --filter "publish=${PORT}" --format '{{.Names}}' | grep -- '-wordpress-' | head -1)"
	if [ -n "${CONTAINER}" ]; then
		WP_DIR="$(docker inspect "${CONTAINER}" --format '{{range .Mounts}}{{if eq .Destination "/var/www/html"}}{{.Source}}{{end}}{{end}}')"
		INSTALL_PATH="${WP_DIR%/WordPress}"
	fi
fi
if [ -z "${INSTALL_PATH}" ]; then
	echo "Could not find the wp-env instance for ${CONFIG_FILE}; is it running?" >&2
	exit 1
fi
MU_DIR="${INSTALL_PATH}/WordPress/wp-content/mu-plugins"

mkdir -p "${MU_DIR}"
cat > "${MU_DIR}/openstation-network-dev.php" <<'PHP'
<?php
/**
 * Plugin Name: OpenStation dev: network between wp-env instances
 * Description: Reaches sibling wp-env instances through the Docker host, so two local installs can pair as an OpenStation network. Written by bin/wp-env-network-dev.sh; never shipped.
 */

add_filter(
	'openstation_network_request_url',
	static function ( $url ) {
		return preg_replace( '#^http://(localhost|127\.0\.0\.1):(\d+)#', 'http://host.docker.internal:$2', (string) $url );
	}
);

// The other instance still has to see the host it knows itself by: a
// multisite keyed on localhost:8890 sends any other Host to signup.
add_filter(
	'http_request_args',
	static function ( $args, $url ) {
		if ( preg_match( '#^http://host\.docker\.internal:(\d+)#', (string) $url, $m ) ) {
			$args['headers']         = isset( $args['headers'] ) && is_array( $args['headers'] ) ? $args['headers'] : array();
			$args['headers']['Host'] = 'localhost:' . $m[1];
		}
		return $args;
	},
	10,
	2
);
PHP
echo "wp-env network dev shim written to ${MU_DIR}"
