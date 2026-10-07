<?php

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Settings {

	public function user_preference( $key, $fallback = null );

	public function site_option( $key, $fallback = null );
}
