<?php
/**
 * OpenStation App Framework — view capture.
 *
 * A view is a callable that paints markup for a state: it may echo
 * (the natural thing inside `?> … <?php` blocks), return a string, or
 * both. `View::capture()` turns either into the HTML string the
 * runtime ships.
 *
 * @package OpenStation
 */

namespace OpenStation\App;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

/**
 * Turns a view callable into HTML.
 */
final class View {

	/**
	 * Run a view callable and collect everything it painted.
	 *
	 * @param callable $view  `function ( State $state, Os $os )`.
	 * @param State    $state Current state.
	 * @param Os       $os    Host handle.
	 * @return string HTML.
	 * @throws \Throwable Whatever the view threw, after the output buffer is discarded.
	 */
	public static function capture( callable $view, State $state, Os $os ) {
		ob_start();
		try {
			$returned = $view( $state, $os );
		} catch ( \Throwable $e ) {
			ob_end_clean();
			throw $e;
		}
		$echoed = (string) ob_get_clean();
		return $echoed . ( is_string( $returned ) ? $returned : '' );
	}
}
