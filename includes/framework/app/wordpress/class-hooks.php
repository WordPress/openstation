<?php

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Hooks as HooksContract;

defined( 'ABSPATH' ) || exit;

final class Hooks implements HooksContract {

	public function filter( $hook, $value, ...$args ) {

		return apply_filters( (string) $hook, $value, ...$args );
	}

	public function action( $hook, ...$args ) {

		do_action( (string) $hook, ...$args );
	}
}
