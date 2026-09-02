<?php
/**
 * OpenStation App Framework — WordPress Hooks adapter.
 *
 * `filter()` is `apply_filters()`, `action()` is `do_action()`. An
 * app's seams are therefore ordinary WordPress hooks that any plugin
 * can attach to with `add_filter()` / `add_action()`.
 *
 * @package OpenStation
 */

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Hooks as HooksContract;

defined( 'ABSPATH' ) || exit;

/**
 * WordPress filters and actions.
 */
final class Hooks implements HooksContract {

	/** {@inheritDoc} */
	public function filter( $hook, $value, ...$args ) {
		// phpcs:ignore WordPress.NamingConventions.ValidHookName.UseUnderscores -- The app names the hook; the adapter only relays it.
		return apply_filters( (string) $hook, $value, ...$args );
	}

	/** {@inheritDoc} */
	public function action( $hook, ...$args ) {
		// phpcs:ignore WordPress.NamingConventions.ValidHookName.UseUnderscores -- The app names the hook; the adapter only relays it.
		do_action( (string) $hook, ...$args );
	}
}
