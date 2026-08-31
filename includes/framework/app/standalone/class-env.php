<?php
/**
 * OpenStation App Framework — standalone Env adapter.
 *
 * Answers from PHP itself: real `define()`d constants, a content
 * directory the host passes in, the PHP version as the platform.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Env as EnvContract;

if ( ! defined( 'ABSPATH' ) && ! defined( 'OPENSTATION_STANDALONE' ) ) {
	exit;
}

/**
 * Plain-PHP environment facts.
 */
final class Env implements EnvContract {

	/**
	 * @var string
	 */
	private $content_dir;

	/**
	 * @var string
	 */
	private $environment_type;

	/**
	 * @param string $content_dir      Writable content directory. Defaults to the system temp dir.
	 * @param string $environment_type `production` | `staging` | `development` | `local`.
	 */
	public function __construct( $content_dir = '', $environment_type = 'production' ) {
		$this->content_dir      = '' !== $content_dir ? rtrim( (string) $content_dir, '/\\' ) : sys_get_temp_dir();
		$this->environment_type = (string) $environment_type;
	}

	/** {@inheritDoc} */
	public function constant( $name, $fallback = null ) {
		return defined( $name ) ? constant( $name ) : $fallback;
	}

	/** {@inheritDoc} */
	public function content_dir() {
		return $this->content_dir;
	}

	/** {@inheritDoc} */
	public function platform() {
		return array(
			'name'    => 'PHP',
			'version' => PHP_VERSION,
		);
	}

	/** {@inheritDoc} */
	public function environment_type() {
		return $this->environment_type;
	}

	/** {@inheritDoc} */
	public function is_network() {
		return false;
	}

	/** {@inheritDoc} */
	public function format_datetime( $timestamp, $format = 'Y-m-d H:i:s' ) {
		// phpcs:ignore WordPress.DateTime.RestrictedFunctions.date_date -- The standalone host has no site timezone; PHP's own is the contract here.
		return date( (string) $format, (int) $timestamp );
	}
}
