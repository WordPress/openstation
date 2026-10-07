<?php

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Hooks {

	public function filter( $hook, $value, ...$args );

	public function action( $hook, ...$args );
}
