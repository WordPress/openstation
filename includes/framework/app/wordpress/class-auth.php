<?php
/**
 * OpenStation App Framework — WordPress Auth adapter.
 *
 * @package OpenStation
 */

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Auth as AuthContract;

defined( 'ABSPATH' ) || exit;

/**
 * The current WordPress user.
 */
final class Auth implements AuthContract {

	/** {@inheritDoc} */
	public function user_id() {
		return (int) get_current_user_id();
	}

	/** {@inheritDoc} */
	public function is_logged_in() {
		return is_user_logged_in();
	}

	/** {@inheritDoc} */
	public function can( $capability ) {
		return current_user_can( (string) $capability );
	}
}
