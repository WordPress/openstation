<?php

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Auth as AuthContract;

defined( 'ABSPATH' ) || exit;

final class Auth implements AuthContract {

	public function user_id() {
		return (int) get_current_user_id();
	}

	public function is_logged_in() {
		return is_user_logged_in();
	}

	public function can( $capability, ...$args ) {
		return current_user_can( (string) $capability, ...$args );
	}
}
