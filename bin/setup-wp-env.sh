#!/usr/bin/env bash
set -euo pipefail

WP_ENV_BIN="${WP_ENV_BIN:-./node_modules/.bin/wp-env}"

enable_guidelines_experiment() {
	local target="$1"

	if ! "${WP_ENV_BIN}" run "${target}" wp plugin is-installed gutenberg; then
		"${WP_ENV_BIN}" run "${target}" wp plugin install gutenberg
	fi
	# `desktop-mode` is the plugin SLUG, not the product name, and it is
	# frozen: it is the directory both .wp-env*.json files mount this
	# checkout into (`wp-content/plugins/desktop-mode`) and the wp.org
	# slug. A rename sweep caught it here once and `wp plugin activate`
	# started failing with "the 'openstation' plugin could not be found",
	# which aborted this whole script — so the Guidelines experiment below
	# never got enabled and the plugin was left INACTIVE on every fresh
	# `wp-env start`. Leave it alone.
	"${WP_ENV_BIN}" run "${target}" wp plugin activate desktop-mode gutenberg
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
