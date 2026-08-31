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

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
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
	 * @param string $capability Capability slug, e.g. `manage_options`.
	 * @return bool
	 */
	public function can( $capability );
}
