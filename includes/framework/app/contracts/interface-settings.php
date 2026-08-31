<?php
/**
 * OpenStation App Framework — Settings contract.
 *
 * Per-user preferences and site-wide options, read-only from an
 * app's point of view. Writes stay with the host: a window that
 * needs to persist something registers its own storage.
 *
 * @package OpenStation
 */

namespace OpenStation\App\Contracts;

// Direct access, unless a standalone host is booting on bare PHP.
if ( ! defined( 'ABSPATH' ) ) {
	defined( 'OPENSTATION_STANDALONE' ) || exit;
}

interface Settings {

	/**
	 * A preference of the acting user — on WordPress, one key of the
	 * OpenStation Preferences blob (`developerModeEnabled`, …).
	 *
	 * @param string $key      Preference key.
	 * @param mixed  $fallback Returned when the key is unset.
	 * @return mixed
	 */
	public function user_preference( $key, $fallback = null );

	/**
	 * A site-wide option.
	 *
	 * @param string $key      Option name.
	 * @param mixed  $fallback Returned when the option is unset.
	 * @return mixed
	 */
	public function site_option( $key, $fallback = null );
}
