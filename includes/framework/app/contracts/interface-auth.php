<?php

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Auth {

	public function user_id();

	public function is_logged_in();

	public function can( $capability, ...$args );
}
