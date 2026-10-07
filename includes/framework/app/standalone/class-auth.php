<?php

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Auth as AuthContract;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

final class Auth implements AuthContract {

	private $user_id;

	private $capabilities;

	public function __construct( $user_id = 0, array $capabilities = array() ) {
		$this->user_id      = (int) $user_id;
		$this->capabilities = array_map( 'strval', $capabilities );
	}

	public function user_id() {
		return $this->user_id;
	}

	public function is_logged_in() {
		return $this->user_id > 0;
	}

	public function can( $capability, ...$args ) {
		return in_array( '*', $this->capabilities, true )
			|| in_array( (string) $capability, $this->capabilities, true );
	}
}
