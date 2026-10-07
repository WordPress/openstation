<?php

namespace OpenStation\App\Contracts;

if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Env {

	public function constant( $name, $fallback = null );

	public function content_dir();

	public function platform();

	public function environment_type();

	public function is_network();

	public function format_datetime( $timestamp, $format = 'Y-m-d H:i:s' );
}
