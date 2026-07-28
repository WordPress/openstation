<?php
/**
 * Remove Background — configuration.
 *
 * Deliberately NO admin settings UI: the extension's only user-facing
 * surface is the `media-tools/remove-background` ability itself.
 * Configuration is code/CLI-level, resolved in this order (later
 * wins):
 *
 *   1. The `desktop_mode_remove_background` option, e.g.
 *      `wp option update desktop_mode_remove_background
 *       '{"backend":"removebg","removebg_api_key":"KEY"}' --format=json`
 *   2. Constants: `DESKTOP_MODE_REMOVE_BG_BACKEND`,
 *      `DESKTOP_MODE_REMOVE_BG_API_KEY`,
 *      `DESKTOP_MODE_REMOVE_BG_ENDPOINT` (wp-config.php friendly,
 *      keeps the key out of the database).
 *   3. The `desktop_mode_remove_background_settings` filter.
 *
 * @package DesktopModeRemoveBackground
 */

defined( 'ABSPATH' ) || exit;

/** Option key for the settings bundle. */
const DESKTOP_MODE_REMOVE_BG_OPTION = 'desktop_mode_remove_background';

/**
 * Resolved settings.
 *
 * @return array{backend:string, removebg_api_key:string, rembg_endpoint:string}
 */
function desktop_mode_remove_bg_get_settings() {
	// Default backend is the WordPress AI Client: it rides the site's
	// existing Connectors credentials, so a stock install needs no
	// extension-specific key at all. Sites wanting mask-based quality
	// opt into `removebg` / `rembg` via option, constant, or filter.
	$defaults = array(
		'backend'          => 'ai',
		'removebg_api_key' => '',
		'rembg_endpoint'   => '',
	);

	$raw      = get_option( DESKTOP_MODE_REMOVE_BG_OPTION, array() );
	$settings = is_array( $raw )
		? array_merge( $defaults, array_intersect_key( $raw, $defaults ) )
		: $defaults;

	if ( defined( 'DESKTOP_MODE_REMOVE_BG_BACKEND' ) ) {
		$settings['backend'] = (string) DESKTOP_MODE_REMOVE_BG_BACKEND;
	}
	if ( defined( 'DESKTOP_MODE_REMOVE_BG_API_KEY' ) ) {
		$settings['removebg_api_key'] = (string) DESKTOP_MODE_REMOVE_BG_API_KEY;
	}
	if ( defined( 'DESKTOP_MODE_REMOVE_BG_ENDPOINT' ) ) {
		$settings['rembg_endpoint'] = (string) DESKTOP_MODE_REMOVE_BG_ENDPOINT;
	}

	/**
	 * Filter the resolved Remove Background settings.
	 *
	 * @param array $settings `{ backend, removebg_api_key, rembg_endpoint }`.
	 */
	$filtered = apply_filters( 'desktop_mode_remove_background_settings', $settings );
	if ( is_array( $filtered ) ) {
		$settings = array_merge( $settings, array_intersect_key( $filtered, $defaults ) );
	}

	$settings['backend']          = sanitize_key( (string) $settings['backend'] );
	$settings['removebg_api_key'] = trim( (string) $settings['removebg_api_key'] );
	$settings['rembg_endpoint']   = esc_url_raw( trim( (string) $settings['rembg_endpoint'] ) );

	if ( ! array_key_exists( $settings['backend'], desktop_mode_remove_bg_backends() ) ) {
		$settings['backend'] = 'ai';
	}

	return $settings;
}
