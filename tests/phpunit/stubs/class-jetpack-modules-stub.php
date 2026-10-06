<?php
/**
 * Test stub for Jetpack's `Automattic\Jetpack\Modules`.
 *
 * Loaded alongside the `WPCOM_Stats` stub: the Stats reader is only
 * asked while the Stats module is on, so a stubbed reader without a
 * module state would never be reached. The default (Stats on) keeps
 * the reader's own default, an erroring `get_visits()`, in charge.
 *
 * @package OpenStation
 */

namespace Automattic\Jetpack;

/**
 * Minimal Modules double with a scriptable Stats module state.
 */
class Modules {
	/**
	 * Whether the Stats module reads as active.
	 *
	 * @var bool
	 */
	public static $stats_active = true;

	/**
	 * Scripted stand-in for the module-state read.
	 *
	 * @param string $module Module slug.
	 * @return bool
	 */
	public function is_active( $module ) {
		return 'stats' === $module && self::$stats_active;
	}
}
