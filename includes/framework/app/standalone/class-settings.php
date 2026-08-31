<?php
/**
 * OpenStation App Framework — standalone Settings adapter.
 *
 * Two plain arrays. The host seeds them; apps read them.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Standalone;

use OpenStation\App\Contracts\Settings as SettingsContract;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

/**
 * Array-backed settings.
 */
final class Settings implements SettingsContract {

	/**
	 * @var array<string,mixed>
	 */
	private $preferences;

	/**
	 * @var array<string,mixed>
	 */
	private $options;

	/**
	 * @param array<string,mixed> $preferences Per-user preferences.
	 * @param array<string,mixed> $options     Site options.
	 */
	public function __construct( array $preferences = array(), array $options = array() ) {
		$this->preferences = $preferences;
		$this->options     = $options;
	}

	/** {@inheritDoc} */
	public function user_preference( $key, $fallback = null ) {
		return array_key_exists( $key, $this->preferences ) ? $this->preferences[ $key ] : $fallback;
	}

	/** {@inheritDoc} */
	public function site_option( $key, $fallback = null ) {
		return array_key_exists( $key, $this->options ) ? $this->options[ $key ] : $fallback;
	}
}
