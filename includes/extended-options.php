<?php
/**
 * Desktop Mode — Platform-wide extended options.
 *
 * System-level toggles that enhance the WordPress admin with extra
 * desktop-mode capabilities. Stored in `wp_options` (not per-user) so
 * they affect every user on the site. Admin-only to read or write.
 *
 * Current options:
 *   - media_library_enhanced: when true, enqueues a small JS shim on
 *     every admin page that makes Media Library .attachment tiles
 *     draggable — users can drag images out of the library into any
 *     drop target (text fields, TinyMCE/Gutenberg blocks, custom
 *     drop zones) without the library having to be re-built from
 *     scratch. **Defaults to `true`** — the enhancement is opt-OUT;
 *     sites that want vanilla Media Library behaviour must explicitly
 *     toggle it off in OS Settings → Extended Options.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** wp_options key for the extended options bundle. */
const WPDM_EXTENDED_OPTIONS_KEY = 'wp_desktop_extended_options';

// ---------------------------------------------------------------------------
// Get / save
// ---------------------------------------------------------------------------

/**
 * Returns the extended options with defaults filled in.
 *
 * @since 0.14.0
 *
 * @return array{ media_library_enhanced: bool }
 */
function wpdm_get_extended_options() {
	$defaults = array(
		'media_library_enhanced' => true,
	);
	$raw = get_option( WPDM_EXTENDED_OPTIONS_KEY, array() );
	if ( ! is_array( $raw ) ) {
		return $defaults;
	}
	// Fall back to the default only when the key is ABSENT — so an
	// admin who explicitly saved `false` stays opted-out even though
	// the shipped default is now `true`. `! empty()` would wrongly
	// coerce an explicit `false` back to the default.
	return array(
		'media_library_enhanced' => array_key_exists( 'media_library_enhanced', $raw )
			? (bool) $raw['media_library_enhanced']
			: $defaults['media_library_enhanced'],
	);
}

/**
 * Persists extended options to `wp_options`.
 *
 * @since 0.14.0
 *
 * @param mixed $raw Incoming payload.
 * @return bool
 */
function wpdm_save_extended_options( $raw ) {
	if ( ! is_array( $raw ) ) {
		return false;
	}
	$clean = array(
		'media_library_enhanced' => ! empty( $raw['media_library_enhanced'] ),
	);
	return update_option( WPDM_EXTENDED_OPTIONS_KEY, $clean, false );
}

// ---------------------------------------------------------------------------
// REST endpoint — admin only
// ---------------------------------------------------------------------------

/**
 * Registers the extended options REST route.
 *
 * @since 0.14.0
 */
function wpdm_register_extended_options_rest_routes() {
	register_rest_route(
		'wp-desktop/v1',
		'/extended-options',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'wpdm_rest_get_extended_options',
				'permission_callback' => 'wpdm_rest_extended_options_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'wpdm_rest_save_extended_options',
				'permission_callback' => 'wpdm_rest_extended_options_permission',
				'args'                => array(
					'options' => array(
						'required' => true,
						'type'     => 'object',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'wpdm_register_extended_options_rest_routes' );

/**
 * Permission: admins only.
 *
 * @since 0.14.0
 *
 * @return bool|WP_Error
 */
function wpdm_rest_extended_options_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'wpdm_extended_forbidden',
			'Only administrators can manage extended options.',
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * GET /wp-desktop/v1/extended-options
 *
 * @since 0.14.0
 *
 * @return WP_REST_Response
 */
function wpdm_rest_get_extended_options() {
	return rest_ensure_response( wpdm_get_extended_options() );
}

/**
 * POST /wp-desktop/v1/extended-options
 *
 * @since 0.14.0
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function wpdm_rest_save_extended_options( WP_REST_Request $request ) {
	$payload = $request->get_param( 'options' );
	wpdm_save_extended_options( $payload );
	return rest_ensure_response( wpdm_get_extended_options() );
}

// ---------------------------------------------------------------------------
// Media Library enhancement enqueue
// ---------------------------------------------------------------------------

/**
 * Enqueues the media-library enhancement shim when the admin has
 * toggled it on. The script is a no-op on pages where wp.media isn't
 * loaded (it checks at runtime), so there's no harm in enqueuing
 * globally in the admin.
 *
 * @since 0.14.0
 */
function wpdm_enqueue_media_library_enhancement() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	$options = wpdm_get_extended_options();
	if ( empty( $options['media_library_enhanced'] ) ) {
		return;
	}

	wp_enqueue_script(
		'wpdm-media-library-enhanced',
		WPDM_URL . 'assets/js/media-library-enhanced.js',
		array(),
		WPDM_VERSION,
		true
	);
}
add_action( 'admin_enqueue_scripts', 'wpdm_enqueue_media_library_enhancement', 20 );
