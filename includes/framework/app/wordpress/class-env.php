<?php

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Env as EnvContract;

defined( 'ABSPATH' ) || exit;

final class Env implements EnvContract {

	public function constant( $name, $fallback = null ) {
		return defined( $name ) ? constant( $name ) : $fallback;
	}

	public function content_dir() {
		return rtrim( WP_CONTENT_DIR, '/\\' );
	}

	public function platform() {
		return array(
			'name'    => 'WordPress',
			'version' => (string) get_bloginfo( 'version' ),
		);
	}

	public function environment_type() {
		return (string) wp_get_environment_type();
	}

	public function is_network() {
		return is_multisite();
	}

	public function format_datetime( $timestamp, $format = 'Y-m-d H:i:s' ) {
		return (string) wp_date( (string) $format, (int) $timestamp );
	}
}
