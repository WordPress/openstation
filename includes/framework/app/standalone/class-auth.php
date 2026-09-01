<?php
/**
 * OpenStation App Framework — standalone Auth adapter.
 *
 * An in-memory principal: the host hands over a user id and the
 * capabilities it holds. `'*'` grants everything, which is what a
 * CLI runner or a test wants.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Auth as AuthContract;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * In-memory principal.
 */
final class Auth implements AuthContract {

	/**
	 * Acting user id.
	 *
	 * @var int
	 */
	private $user_id;

	/**
	 * Granted capabilities.
	 *
	 * @var string[]
	 */
	private $capabilities;

	/**
	 * @param int      $user_id      Acting user id; 0 for anonymous.
	 * @param string[] $capabilities Capabilities held, or `array( '*' )` for all.
	 */
	public function __construct( $user_id = 0, array $capabilities = array() ) {
		$this->user_id      = (int) $user_id;
		$this->capabilities = array_map( 'strval', $capabilities );
	}

	/** {@inheritDoc} */
	public function user_id() {
		return $this->user_id;
	}

	/** {@inheritDoc} */
	public function is_logged_in() {
		return $this->user_id > 0;
	}

	/** {@inheritDoc} */
	public function can( $capability, ...$args ) {
		return in_array( '*', $this->capabilities, true )
			|| in_array( (string) $capability, $this->capabilities, true );
	}
}
