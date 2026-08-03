<?php
/**
 * Test stub for Jetpack's `Automattic\Jetpack\Stats\WPCOM_Stats`.
 *
 * Lets the Living Tree traffic tests exercise the Jetpack-first path
 * without Jetpack installed. The default behaviour (WP_Error) matches
 * "Jetpack present but erroring", which must fall back to the
 * post-views meta exactly like "no Jetpack" — so merely loading this
 * stub does not change any other test's observable behaviour.
 *
 * Guard the require with `class_exists()` so a test environment that
 * DOES ship real Jetpack never collides with the stub.
 *
 * @package OpenStation
 */

namespace Automattic\Jetpack\Stats;

/**
 * Minimal WPCOM_Stats double with a scriptable `get_visits()`.
 */
class WPCOM_Stats {
	/**
	 * Next `get_visits()` return value. `null` → WP_Error (the
	 * fallback-triggering default).
	 *
	 * @var mixed
	 */
	public static $visits_response = null;

	/**
	 * Args of the most recent `get_visits()` call, for assertions.
	 *
	 * @var array|null
	 */
	public static $last_args = null;

	/**
	 * Scripted stand-in for the WPCOM `/stats/visits` read.
	 *
	 * @param array $args Query args (unit, quantity).
	 * @return mixed The scripted response or WP_Error.
	 */
	public function get_visits( $args = array() ) {
		self::$last_args = $args;
		if ( null === self::$visits_response ) {
			return new \WP_Error( 'stub-unconfigured', 'No response scripted.' );
		}
		return self::$visits_response;
	}
}
