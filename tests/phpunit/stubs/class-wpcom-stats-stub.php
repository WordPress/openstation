<?php

namespace Automattic\Jetpack\Stats;

if ( ! class_exists( '\Automattic\Jetpack\Modules' ) ) {
	require_once __DIR__ . '/class-jetpack-modules-stub.php';
}

class WPCOM_Stats {

	public static $visits_response = null;

	public static $last_args = null;

	public function get_visits( $args = array() ) {
		self::$last_args = $args;
		if ( null === self::$visits_response ) {
			return new \WP_Error( 'stub-unconfigured', 'No response scripted.' );
		}
		return self::$visits_response;
	}
}
