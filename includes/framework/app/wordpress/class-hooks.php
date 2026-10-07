<?php

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Hooks as HooksContract;

defined( 'ABSPATH' ) || exit;

final class Hooks implements HooksContract {

	public function filter( $hook, $value, ...$args ) {
		// phpcs:ignore WordPress.NamingConventions.ValidHookName.UseUnderscores -- The app names the hook; the adapter only relays it.
		return apply_filters( (string) $hook, $value, ...$args );
	}

	public function action( $hook, ...$args ) {
		// phpcs:ignore WordPress.NamingConventions.ValidHookName.UseUnderscores -- The app names the hook; the adapter only relays it.
		do_action( (string) $hook, ...$args );
	}
}
