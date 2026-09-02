<?php
/**
 * OpenStation App Framework — Auth contract.
 *
 * Who is asking. The WordPress adapter answers from the current user;
 * the standalone adapter answers from whatever the host injected.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Contracts;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Auth {

	/**
	 * Numeric id of the acting user, 0 when anonymous.
	 *
	 * @return int
	 */
	public function user_id();

	/**
	 * Whether the acting user is authenticated at all.
	 *
	 * @return bool
	 */
	public function is_logged_in();

	/**
	 * Whether the acting user holds a capability.
	 *
	 * Extra arguments address a meta-capability's object — the id in
	 * `can( 'delete_post', $post_id )`. The WordPress adapter forwards
	 * them to `current_user_can()`; the standalone adapter answers
	 * from the capability name alone.
	 *
	 * @param string $capability Capability slug, e.g. `manage_options`.
	 * @param mixed  ...$args    Object the capability is asked against.
	 * @return bool
	 */
	public function can( $capability, ...$args );
}
