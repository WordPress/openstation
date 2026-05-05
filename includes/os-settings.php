<?php
/**
 * Desktop Mode — OS Settings Persistence.
 *
 * Persists each user's OS Settings preferences (wallpaper, accent color,
 * dock size, custom gradient/image, HD-only toggle, and AI integration
 * settings) to user meta so they survive across browsers, devices, and
 * private/incognito sessions. The JS layer writes to localStorage on
 * every change for instant read-back, then asynchronously syncs to this
 * endpoint so user meta is the durable source of truth.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/** User meta key for OS Settings. */
const DESKTOP_MODE_OS_SETTINGS_META_KEY = 'desktop_mode_os_settings';

/** Valid dock-size IDs — mirrors the TS `DOCK_SIZES` constant. */
const DESKTOP_MODE_OS_SETTINGS_DOCK_SIZES = array( 'compact', 'default', 'large' );

/** Valid desktop-layout IDs — mirrors the TS `DESKTOP_LAYOUTS` constant. */
const DESKTOP_MODE_OS_SETTINGS_DESKTOP_LAYOUTS = array( 'classic', 'unified', 'spatial' );

/**
 * Valid AI live-progress transports — mirrors the TS `AI_TRANSPORTS` constant.
 *
 * - `sse` — Server-Sent Events; real-time progress ticks. Requires the host
 *   to allow long-lived `text/event-stream` connections.
 * - `off` — single request, no progress ticks. Works everywhere; the user
 *   sees "Thinking…" until the final answer.
 *
 * Default is `off` because some hosts (locked-down shared environments,
 * proxies that buffer responses) silently drop SSE mid-stream, which surfaces
 * to the user as "Lost connection to the assistant".
 */
const DESKTOP_MODE_OS_SETTINGS_AI_TRANSPORTS = array( 'sse', 'off' );

/**
 * Built-in AI provider IDs.
 *
 * Other providers register themselves via {@see desktop_mode_register_ai_provider()};
 * sanitization no longer gates the field against this list (the active-provider
 * resolver does the existence check at lookup time).
 *
 * @deprecated 0.18.0 Kept for backwards compatibility; use the provider registry.
 */
const DESKTOP_MODE_OS_SETTINGS_AI_PROVIDERS = array( 'openai' );

/**
 * Returns a well-shaped default OS settings array.
 *
 * Mirrors the TypeScript `DEFAULTS` constant so a fresh user account
 * gets the same starting state in both environments.
 *
 * @since 0.14.0
 *
 * @return array
 */
function desktop_mode_default_os_settings() {
	return array(
		'wallpaper'    => 'dark',
		'accent'       => 'wp-blue',
		'dockSize'     => 'default',
		'desktopLayout' => 'classic',
		'dockRailRenderer' => 'default',
		'customGradient' => array(
			'from'  => '#2271b1',
			'to'    => '#7c3aed',
			'angle' => 135,
		),
		'customImage'  => null,
		'libraryHdOnly' => true,
		'ai'           => array(
			'enabled'   => false,
			'provider'  => 'openai',
			'apiKey'    => '',     // Legacy field — treated as the OpenAI key for backwards compat.
			'apiKeys'   => array(), // Per-provider keys: { [provider_id]: string }.
			'transport' => 'off',   // Live-progress transport: 'sse' | 'off'. Default off — see DESKTOP_MODE_OS_SETTINGS_AI_TRANSPORTS.
		),
		// Per-user opt-in for the native Posts window. When true, clicking
		// the Posts dock tile opens the `<wpd-table>`-driven native window
		// instead of the chromeless `edit.php` iframe. Default off so
		// existing muscle memory survives an upgrade.
		'nativePostsEnabled'       => false,
		// Per-user list of column keys hidden in the native Posts
		// window (e.g. array( 'author', 'tags' )). Empty array means
		// every column is visible. The sticky 'title' column is always
		// shown — the UI prevents toggling it.
		'nativePostsHiddenColumns' => array(),
	);
}

/**
 * Retrieves the saved OS settings for a user.
 *
 * Always returns a fully-shaped array so the JS side doesn't need to
 * defend against partial or missing keys.
 *
 * @since 0.14.0
 *
 * @param int $user_id The user ID.
 * @return array
 */
function desktop_mode_get_os_settings( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return desktop_mode_default_os_settings();
	}

	$raw = get_user_meta( $user_id, DESKTOP_MODE_OS_SETTINGS_META_KEY, true );
	if ( ! is_array( $raw ) ) {
		return desktop_mode_default_os_settings();
	}

	return desktop_mode_sanitize_os_settings( $raw );
}

/**
 * Saves sanitized OS settings for a user.
 *
 * @since 0.14.0
 *
 * @param int   $user_id  The user ID.
 * @param mixed $settings Raw settings payload from the client.
 * @return bool True on success, false otherwise.
 */
function desktop_mode_save_os_settings( $user_id, $settings ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}

	$clean = desktop_mode_sanitize_os_settings( $settings );
	return false !== update_user_meta( $user_id, DESKTOP_MODE_OS_SETTINGS_META_KEY, $clean );
}

/**
 * Sanitizes a raw OS settings payload.
 *
 * Unknown keys are ignored; known keys are coerced field-by-field so a
 * partial save (e.g., only accent changed) merges cleanly with the
 * defaults rather than wiping unset fields.
 *
 * @since 0.14.0
 *
 * @param mixed $raw Raw settings from the client or user meta.
 * @return array Sanitized settings.
 */
function desktop_mode_sanitize_os_settings( $raw ) {
	$defaults = desktop_mode_default_os_settings();

	if ( ! is_array( $raw ) ) {
		return $defaults;
	}

	// Wallpaper — any non-empty string; registry membership is validated
	// client-side at apply time.
	$wallpaper = isset( $raw['wallpaper'] ) && is_string( $raw['wallpaper'] ) && '' !== $raw['wallpaper']
		? sanitize_key( $raw['wallpaper'] )
		: $defaults['wallpaper'];

	// Accent — non-empty string; swatch validity is enforced in the picker.
	$accent = isset( $raw['accent'] ) && is_string( $raw['accent'] ) && '' !== $raw['accent']
		? sanitize_key( $raw['accent'] )
		: $defaults['accent'];

	// Dock size — must be one of the three known values.
	$dock_size = isset( $raw['dockSize'] ) && in_array( $raw['dockSize'], DESKTOP_MODE_OS_SETTINGS_DOCK_SIZES, true )
		? (string) $raw['dockSize']
		: $defaults['dockSize'];

	// Desktop layout — must be one of the three known values
	// (`classic`, `unified`, `spatial`). Default `classic`.
	$desktop_layout = isset( $raw['desktopLayout'] )
		&& in_array( $raw['desktopLayout'], DESKTOP_MODE_OS_SETTINGS_DESKTOP_LAYOUTS, true )
		? (string) $raw['desktopLayout']
		: $defaults['desktopLayout'];

	// Submenu renderer id — accept any sanitize_key()-clean string.
	// We don't gate on a server-side allow-list because renderers
	// register from JS at runtime; existence is checked by the
	// client at resolve time and falls back to `'default'` when
	// missing.
	// Dock rail renderer id — accept any sanitize_key()-clean
	// string. JS-side registry resolves at use time and falls back
	// to `'default'` when the picked renderer isn't registered.
	$dock_rail_renderer = $defaults['dockRailRenderer'];
	if ( isset( $raw['dockRailRenderer'] ) && is_string( $raw['dockRailRenderer'] ) ) {
		$slug = sanitize_key( $raw['dockRailRenderer'] );
		if ( '' !== $slug ) {
			$dock_rail_renderer = $slug;
		}
	}

	// Custom gradient — { from, to: valid hex; angle: int 0–360 }.
	$custom_gradient = $defaults['customGradient'];
	if ( isset( $raw['customGradient'] ) && is_array( $raw['customGradient'] ) ) {
		$cg = $raw['customGradient'];
		if ( isset( $cg['from'] ) && is_string( $cg['from'] ) && preg_match( '/^#[0-9a-f]{3,8}$/i', $cg['from'] ) ) {
			$custom_gradient['from'] = strtolower( $cg['from'] );
		}
		if ( isset( $cg['to'] ) && is_string( $cg['to'] ) && preg_match( '/^#[0-9a-f]{3,8}$/i', $cg['to'] ) ) {
			$custom_gradient['to'] = strtolower( $cg['to'] );
		}
		if ( isset( $cg['angle'] ) && is_numeric( $cg['angle'] ) ) {
			$angle = (int) $cg['angle'];
			if ( $angle >= 0 && $angle <= 360 ) {
				$custom_gradient['angle'] = $angle;
			}
		}
	}

	// Custom image — { id: positive int, url: valid https? URL } or null.
	$custom_image = null;
	if ( isset( $raw['customImage'] ) && is_array( $raw['customImage'] ) ) {
		$ci = $raw['customImage'];
		$ci_id  = isset( $ci['id'] ) && is_numeric( $ci['id'] ) ? (int) $ci['id'] : 0;
		$ci_url = isset( $ci['url'] ) ? esc_url_raw( (string) $ci['url'] ) : '';
		if ( $ci_id > 0 && '' !== $ci_url && preg_match( '/^https?:\/\//i', $ci_url ) ) {
			$custom_image = array(
				'id'  => $ci_id,
				'url' => $ci_url,
			);
		}
	}

	// Library HD only — boolean.
	$library_hd_only = isset( $raw['libraryHdOnly'] ) ? (bool) $raw['libraryHdOnly'] : $defaults['libraryHdOnly'];

	// AI settings.
	$ai = $defaults['ai'];
	if ( isset( $raw['ai'] ) && is_array( $raw['ai'] ) ) {
		$raw_ai = $raw['ai'];

		if ( isset( $raw_ai['enabled'] ) ) {
			$ai['enabled'] = (bool) $raw_ai['enabled'];
		}

		// Provider — accept any sanitize_key()-clean string. We don't gate
		// on the registry here because providers register on `init` and
		// sanitize may run earlier (REST boot). Existence is checked at
		// lookup time by `desktop_mode_ai_get_active_provider_id()`.
		if ( isset( $raw_ai['provider'] ) && is_string( $raw_ai['provider'] ) ) {
			$slug = sanitize_key( $raw_ai['provider'] );
			if ( '' !== $slug ) {
				$ai['provider'] = $slug;
			}
		}

		// API key — strip tags and limit length. The key is opaque to us;
		// we just store what the user gives. 512 chars is generous for any
		// real API key while preventing runaway meta writes.
		if ( isset( $raw_ai['apiKey'] ) && is_string( $raw_ai['apiKey'] ) ) {
			$ai['apiKey'] = substr( sanitize_text_field( $raw_ai['apiKey'] ), 0, 512 );
		}

		// Live-progress transport — must be one of the known values.
		if (
			isset( $raw_ai['transport'] )
			&& is_string( $raw_ai['transport'] )
			&& in_array( $raw_ai['transport'], DESKTOP_MODE_OS_SETTINGS_AI_TRANSPORTS, true )
		) {
			$ai['transport'] = $raw_ai['transport'];
		}

		// Per-provider keys map. Limited to 32 entries to bound storage.
		if ( isset( $raw_ai['apiKeys'] ) && is_array( $raw_ai['apiKeys'] ) ) {
			$keys = array();
			foreach ( $raw_ai['apiKeys'] as $pid => $val ) {
				if ( count( $keys ) >= 32 ) {
					break;
				}
				$slug = sanitize_key( (string) $pid );
				if ( '' === $slug || ! is_string( $val ) ) {
					continue;
				}
				$keys[ $slug ] = substr( sanitize_text_field( $val ), 0, 512 );
			}
			$ai['apiKeys'] = $keys;
		}
	}

	$native_posts_enabled = isset( $raw['nativePostsEnabled'] )
		? (bool) $raw['nativePostsEnabled']
		: $defaults['nativePostsEnabled'];

	$native_posts_hidden_columns = $defaults['nativePostsHiddenColumns'];
	if ( isset( $raw['nativePostsHiddenColumns'] ) && is_array( $raw['nativePostsHiddenColumns'] ) ) {
		$native_posts_hidden_columns = array();
		foreach ( $raw['nativePostsHiddenColumns'] as $col ) {
			if ( ! is_string( $col ) || '' === $col ) {
				continue;
			}
			$slug = sanitize_key( $col );
			if ( '' === $slug ) {
				continue;
			}
			$native_posts_hidden_columns[] = $slug;
		}
		// Cap to a sane upper bound — far more than any plausible
		// column count, but blocks a malicious payload from bloating
		// user meta indefinitely.
		$native_posts_hidden_columns = array_slice( array_values( array_unique( $native_posts_hidden_columns ) ), 0, 32 );
	}

	return array(
		'wallpaper'                => $wallpaper,
		'accent'                   => $accent,
		'dockSize'                 => $dock_size,
		'desktopLayout'            => $desktop_layout,
		'dockRailRenderer'         => $dock_rail_renderer,
		'customGradient'           => $custom_gradient,
		'customImage'              => $custom_image,
		'libraryHdOnly'            => $library_hd_only,
		'ai'                       => $ai,
		'nativePostsEnabled'       => $native_posts_enabled,
		'nativePostsHiddenColumns' => $native_posts_hidden_columns,
	);
}

/**
 * Registers the REST routes for OS settings.
 *
 * @since 0.14.0
 */
function desktop_mode_register_os_settings_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/os-settings',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'desktop_mode_rest_get_os_settings',
				'permission_callback' => 'desktop_mode_rest_os_settings_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'desktop_mode_rest_save_os_settings',
				'permission_callback' => 'desktop_mode_rest_os_settings_permission',
				'args'                => array(
					'settings' => array(
						'required' => true,
						'type'     => 'object',
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_os_settings_rest_routes' );

/**
 * Permission gate for OS settings REST routes.
 *
 * @since 0.14.0
 *
 * @return bool
 */
function desktop_mode_rest_os_settings_permission() {
	return is_user_logged_in() && current_user_can( 'read' );
}

/**
 * GET /desktop-mode/v1/os-settings
 *
 * @since 0.14.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_rest_get_os_settings() {
	return rest_ensure_response( desktop_mode_get_os_settings( get_current_user_id() ) );
}

/**
 * POST /desktop-mode/v1/os-settings
 *
 * @since 0.14.0
 *
 * @param WP_REST_Request $request The REST request.
 * @return WP_REST_Response The saved settings (after sanitization).
 */
function desktop_mode_rest_save_os_settings( WP_REST_Request $request ) {
	$user_id  = get_current_user_id();
	$payload  = $request->get_param( 'settings' );
	desktop_mode_save_os_settings( $user_id, $payload );
	return rest_ensure_response( desktop_mode_get_os_settings( $user_id ) );
}
