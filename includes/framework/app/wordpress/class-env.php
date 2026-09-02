<?php
/**
 * OpenStation App Framework — WordPress Env adapter.
 *
 * @package OpenStation
 */

namespace OpenStation\App\WordPress;

use OpenStation\App\Contracts\Env as EnvContract;

defined( 'ABSPATH' ) || exit;

/**
 * WordPress environment facts.
 */
final class Env implements EnvContract {

	/** {@inheritDoc} */
	public function constant( $name, $fallback = null ) {
		return defined( $name ) ? constant( $name ) : $fallback;
	}

	/** {@inheritDoc} */
	public function content_dir() {
		return rtrim( WP_CONTENT_DIR, '/\\' );
	}

	/** {@inheritDoc} */
	public function platform() {
		return array(
			'name'    => 'WordPress',
			'version' => (string) get_bloginfo( 'version' ),
		);
	}

	/** {@inheritDoc} */
	public function environment_type() {
		return (string) wp_get_environment_type();
	}

	/** {@inheritDoc} */
	public function is_network() {
		return is_multisite();
	}

	/** {@inheritDoc} */
	public function format_datetime( $timestamp, $format = 'Y-m-d H:i:s' ) {
		return (string) wp_date( (string) $format, (int) $timestamp );
	}
}
