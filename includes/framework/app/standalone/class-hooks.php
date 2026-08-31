<?php
/**
 * OpenStation App Framework — standalone Hooks adapter.
 *
 * A minimal in-process hook bus with the same semantics as
 * WordPress's: filters return the value, actions return nothing,
 * callbacks run in ascending priority then registration order.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Hooks as HooksContract;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * In-process hook bus.
 */
final class Hooks implements HooksContract {

	/**
	 * `hook => priority => callable[]`.
	 *
	 * @var array<string,array<int,callable[]>>
	 */
	private $callbacks = array();

	/**
	 * Register a callback for a filter or an action.
	 *
	 * @param string   $hook     Hook name.
	 * @param callable $callback Callback.
	 * @param int      $priority Lower runs first. Default 10.
	 * @return void
	 */
	public function add( $hook, callable $callback, $priority = 10 ) {
		$this->callbacks[ $hook ][ (int) $priority ][] = $callback;
		ksort( $this->callbacks[ $hook ] );
	}

	/**
	 * Drop every callback registered for a hook.
	 *
	 * @param string $hook Hook name.
	 * @return void
	 */
	public function remove_all( $hook ) {
		unset( $this->callbacks[ $hook ] );
	}

	/** {@inheritDoc} */
	public function filter( $hook, $value, ...$args ) {
		if ( empty( $this->callbacks[ $hook ] ) ) {
			return $value;
		}
		foreach ( $this->callbacks[ $hook ] as $callbacks ) {
			foreach ( $callbacks as $callback ) {
				$value = call_user_func( $callback, $value, ...$args );
			}
		}
		return $value;
	}

	/** {@inheritDoc} */
	public function action( $hook, ...$args ) {
		if ( empty( $this->callbacks[ $hook ] ) ) {
			return;
		}
		foreach ( $this->callbacks[ $hook ] as $callbacks ) {
			foreach ( $callbacks as $callback ) {
				call_user_func( $callback, ...$args );
			}
		}
	}
}
