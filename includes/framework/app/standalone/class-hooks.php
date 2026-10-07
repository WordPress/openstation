<?php

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Hooks as HooksContract;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Hooks implements HooksContract {

	private $callbacks = array();

	public function add( $hook, callable $callback, $priority = 10 ) {
		$this->callbacks[ $hook ][ (int) $priority ][] = $callback;
		ksort( $this->callbacks[ $hook ] );
	}

	public function remove_all( $hook ) {
		unset( $this->callbacks[ $hook ] );
	}

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
