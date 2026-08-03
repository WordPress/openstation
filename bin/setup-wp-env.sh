#!/usr/bin/env bash
set -euo pipefail

WP_ENV_BIN="${WP_ENV_BIN:-./node_modules/.bin/wp-env}"

enable_guidelines_experiment() {
	local target="$1"

	if ! "${WP_ENV_BIN}" run "${target}" wp plugin is-installed gutenberg; then
		"${WP_ENV_BIN}" run "${target}" wp plugin install gutenberg
	fi
	"${WP_ENV_BIN}" run "${target}" wp plugin activate openstation gutenberg
	"${WP_ENV_BIN}" run "${target}" wp eval '
		$experiments = get_option( "gutenberg-experiments", array() );
		if ( ! is_array( $experiments ) ) {
			$experiments = array();
		}
		$experiments["gutenberg-guidelines"] = true;
		update_option( "gutenberg-experiments", $experiments );
	'
}

enable_guidelines_experiment cli
