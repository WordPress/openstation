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
 *     toggle it off in OS Settings → Features → Extended options.
 *   - games: when true, the games framework loads — Games hub window +
 *     desktop icon, built-in games, score/challenge REST routes, the
 *     Heartbeat challenge channel, and the schema check. **Defaults to
 *     `false`** — games are opt-IN; an admin turns them on in
 *     OS Settings → Features → Extended options. While off,
 *     `includes/games/bootstrap.php` skips every module file, so the
 *     framework consumes no resources at all (see
 *     `desktop_mode_games_enabled()`).
 *   - agents: when true, the AI Agents framework loads — synthetic
 *     agent users, the `/desktop-mode/v1/agents` REST surface, the
 *     Agents section in My WordPress, and the Agent chat window.
 *     **Defaults to `false`** — agents are opt-IN. While off,
 *     `includes/agents/bootstrap.php` skips every module file (see
 *     `desktop_mode_agents_enabled()`).
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** wp_options key for the extended options bundle. */
const DESKTOP_MODE_EXTENDED_OPTIONS_KEY = 'desktop_mode_extended_options';

// ---------------------------------------------------------------------------
// Get / save
// ---------------------------------------------------------------------------

/**
 * Returns the extended options with defaults filled in.
 *
 * @since 0.5.0
 *
 * @return array{ media_library_enhanced: bool, games: bool, agents: bool }
 */
function desktop_mode_get_extended_options() {
	$defaults = array(
		'media_library_enhanced' => true,
		'games'                  => false,
		'agents'                 => false,
	);
	$raw = get_option( DESKTOP_MODE_EXTENDED_OPTIONS_KEY, array() );
	if ( ! is_array( $raw ) ) {
		return $defaults;
	}
	// Fall back to the default only when the key is ABSENT — so an
	// admin who explicitly saved `false` stays opted-out even though
	// the shipped default is now `true`. `! empty()` would wrongly
	// coerce an explicit `false` back to the default.
	$clean = array();
	foreach ( $defaults as $key => $default ) {
		$clean[ $key ] = array_key_exists( $key, $raw )
			? (bool) $raw[ $key ]
			: $default;
	}
	return $clean;
}

/**
 * Persists extended options to `wp_options`.
 *
 * @since 0.5.0
 *
 * @param mixed $raw Incoming payload.
 * @return bool
 */
function desktop_mode_save_extended_options( $raw ) {
	if ( ! is_array( $raw ) ) {
		return false;
	}
	// Merge over the current values so a payload that omits a key (an
	// older client, a partial save) can't silently reset it.
	$clean = desktop_mode_get_extended_options();
	foreach ( $clean as $key => $current ) {
		if ( array_key_exists( $key, $raw ) ) {
			$clean[ $key ] = ! empty( $raw[ $key ] );
		}
	}
	return update_option( DESKTOP_MODE_EXTENDED_OPTIONS_KEY, $clean, false );
}

// ---------------------------------------------------------------------------
// REST endpoint — admin only
// ---------------------------------------------------------------------------

/**
 * Registers the extended options REST route.
 *
 * @since 0.5.0
 */
function desktop_mode_register_extended_options_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/extended-options',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'desktop_mode_rest_get_extended_options',
				'permission_callback' => 'desktop_mode_rest_extended_options_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'desktop_mode_rest_save_extended_options',
				'permission_callback' => 'desktop_mode_rest_extended_options_permission',
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
add_action( 'rest_api_init', 'desktop_mode_register_extended_options_rest_routes' );

/**
 * Permission: admins only.
 *
 * @since 0.5.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_rest_extended_options_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'desktop_mode_extended_forbidden',
			'Only administrators can manage extended options.',
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * GET /desktop-mode/v1/extended-options
 *
 * @since 0.5.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_rest_get_extended_options() {
	return rest_ensure_response( desktop_mode_get_extended_options() );
}

/**
 * POST /desktop-mode/v1/extended-options
 *
 * @since 0.5.0
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function desktop_mode_rest_save_extended_options( WP_REST_Request $request ) {
	$payload = $request->get_param( 'options' );
	desktop_mode_save_extended_options( $payload );
	return rest_ensure_response( desktop_mode_get_extended_options() );
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
 * @since 0.5.0
 */
function desktop_mode_enqueue_media_library_enhancement() {
	if ( ! is_admin() || ! is_user_logged_in() ) {
		return;
	}

	$options = desktop_mode_get_extended_options();
	if ( empty( $options['media_library_enhanced'] ) ) {
		return;
	}

	wp_enqueue_script(
		'desktop-mode-media-library-enhanced',
		DESKTOP_MODE_URL . 'assets/js/media-library-enhanced.js',
		array(),
		DESKTOP_MODE_VERSION,
		true
	);
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_media_library_enhancement', 20 );
