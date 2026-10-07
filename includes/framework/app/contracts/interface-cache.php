<?php

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Cache {

	public function get( $key, $fallback = null );

	public function set( $key, $value, $ttl = 0 );

	public function delete( $key );
}
