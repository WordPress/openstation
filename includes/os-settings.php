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
		// Per-user opt-OUT for the native Posts window. When true,
		// clicking the Posts dock tile opens the `<wpd-table>`-driven
		// native window instead of the chromeless `edit.php` iframe.
		// Default ON as of 0.8.0 — the native UI is the canonical
		// Desktop Mode Posts experience; users can flip it off to fall
		// back to the classic iframe.
		// Per-user override of the WordPress Heartbeat interval, in
		// seconds. 60s matches Core's "idle" default; values below
		// 15 force a lower `minimalInterval` too. See
		// `desktop_mode_apply_heartbeat_rate_setting` for the
		// `heartbeat_settings` filter that applies this.
		'heartbeatRate'            => 60,
		'nativePostsEnabled'       => true,
		// Per-user list of column keys hidden in the native Posts
		// window (e.g. array( 'author', 'tags' )). Empty array means
		// every column is visible. The sticky 'title' column is always
		// shown — the UI prevents toggling it.
		'nativePostsHiddenColumns' => array(),
		// Per-user opt-OUT for the native Pages window. Same posture as
		// nativePostsEnabled — defaults ON, users can flip off to keep
		// the classic `edit.php?post_type=page` iframe.
		'nativePagesEnabled'       => true,
		// Per-user opt-OUT for the native Users window. Defaults ON;
		// the server-side cap gate (`list_users`) means the toggle
		// only matters for users who could see the Users tile anyway.
		'nativeUsersEnabled'       => true,
		// Per-user opt-OUT for the native Plugins window. Defaults ON;
		// the server-side cap gate (`activate_plugins`) means the
		// toggle only matters for users who could see the Plugins
		// tile anyway. When `false`, the dock click falls back to the
		// classic `plugins.php` chromeless iframe path.
		'nativePluginsEnabled'     => true,
		// Per-user opt-OUT for the native Comments window. Defaults ON;
		// the server-side cap gate (`edit_posts`) means the toggle only
		// matters for users who could see the Comments tile anyway.
		'nativeCommentsEnabled'    => true,
		// When true, left-clicking the empty wallpaper triggers the
		// "Show desktop" toggle (macOS-style) and the matching entry is
		// hidden from the wallpaper context menu. When false (default),
		// the entry stays in the menu and left clicks on the wallpaper
		// do nothing. Per-user.
		'showDesktopOnWallpaperClick' => false,
		// Per-user opt-OUT for the folder-sharing feature. Defaults
		// ON. When false:
		//   - The Share button, share-settings modal, "Leave shared
		//     folder" entry, and pending-invite prompt are all
		//     suppressed in the user's shell.
		//   - The heartbeat skips the `shares.pending` payload for
		//     this user so they never see invites land.
		//   - REST share routes return 404 for this user — they
		//     can't list, invite, accept, deny, or leave.
		// Sites that don't want the feature (solo admin, no
		// collaborators) can flip the toggle and the surface
		// disappears without any database changes. The site-wide
		// "Delete folder sharing data" action in OS Settings →
		// Features → Advanced is a separate destructive cleanup.
		'foldersSharingEnabled'    => true,
		// Per-item placement preferences. Map of item id (dock-item
		// slug or registered desktop-icon id) → one of:
		//   'both'    — show on both dock and desktop.
		//   'dock'    — show only on the dock; hide from desktop.
		//   'desktop' — show only on the wallpaper; hide from dock.
		//   'hidden'  — hide from every shell surface.
		// Missing keys mean "no override" — items use their native rail.
		// Sanitized as map<sanitize_key, enum>. Capped at 256 entries.
		'itemVisibility'           => array(),
		// Per-user dock ordering. Ordered list of item ids; ids not in
		// the list keep their server-supplied position appended after
		// the listed ones. Unknown ids are tolerated.
		'dockOrder'                => array(),
		// Persisted desktop position for every dock item the user has
		// promoted to the wallpaper via `itemVisibility[id]=desktop|both`.
		// Keyed by item id, value is `{ x: int, y: int }`. The JS
		// synthesizer reads this when building a synthetic placement so
		// the icon lands where the user last dragged it instead of
		// resetting to (0, 0) on every reload. Capped at 256 entries.
		'dockPromotedPositions'    => array(),
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

	// Heartbeat rate — one of the four allowed values. The PHP
	// filter `desktop_mode_apply_heartbeat_rate_setting` reads
	// this and passes it through to `heartbeat_settings` so
	// WordPress Core itself reduces the interval on the next page
	// load. 5 s is intentionally excluded: Core's
	// `minimalInterval` floor clamps anything below 15 back up to
	// 15 unless every upstream filter cooperates, and the gain
	// over 15 s is marginal.
	$allowed_heartbeat_rates = array( 15, 30, 45, 60 );
	$heartbeat_rate          = $defaults['heartbeatRate'];
	if ( isset( $raw['heartbeatRate'] ) && is_numeric( $raw['heartbeatRate'] ) ) {
		$candidate = (int) $raw['heartbeatRate'];
		if ( in_array( $candidate, $allowed_heartbeat_rates, true ) ) {
			$heartbeat_rate = $candidate;
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

	$native_pages_enabled = isset( $raw['nativePagesEnabled'] )
		? (bool) $raw['nativePagesEnabled']
		: $defaults['nativePagesEnabled'];

	$native_users_enabled = isset( $raw['nativeUsersEnabled'] )
		? (bool) $raw['nativeUsersEnabled']
		: $defaults['nativeUsersEnabled'];

	$native_plugins_enabled = isset( $raw['nativePluginsEnabled'] )
		? (bool) $raw['nativePluginsEnabled']
		: $defaults['nativePluginsEnabled'];

	$native_comments_enabled = isset( $raw['nativeCommentsEnabled'] )
		? (bool) $raw['nativeCommentsEnabled']
		: $defaults['nativeCommentsEnabled'];

	$show_desktop_on_wallpaper_click = isset( $raw['showDesktopOnWallpaperClick'] )
		? (bool) $raw['showDesktopOnWallpaperClick']
		: $defaults['showDesktopOnWallpaperClick'];

	$folders_sharing_enabled = isset( $raw['foldersSharingEnabled'] )
		? (bool) $raw['foldersSharingEnabled']
		: $defaults['foldersSharingEnabled'];

	// itemVisibility — map<sanitize_key, enum>. Unknown ids are kept
	// (a deactivated plugin's setting should survive reactivation);
	// invalid placement values are dropped.
	$item_visibility = array();
	if ( isset( $raw['itemVisibility'] ) && is_array( $raw['itemVisibility'] ) ) {
		$allowed_placements = array( 'both', 'dock', 'desktop', 'hidden' );
		$count              = 0;
		foreach ( $raw['itemVisibility'] as $key => $val ) {
			if ( $count >= 256 ) {
				break;
			}
			if ( ! is_string( $key ) || '' === $key || ! is_string( $val ) ) {
				continue;
			}
			$slug = sanitize_key( $key );
			if ( '' === $slug ) {
				continue;
			}
			if ( ! in_array( $val, $allowed_placements, true ) ) {
				continue;
			}
			$item_visibility[ $slug ] = $val;
			++$count;
		}
	}

	// dockOrder — ordered list of sanitize_key()-clean ids.
	$dock_order = array();
	if ( isset( $raw['dockOrder'] ) && is_array( $raw['dockOrder'] ) ) {
		$seen = array();
		foreach ( $raw['dockOrder'] as $id ) {
			if ( ! is_string( $id ) || '' === $id ) {
				continue;
			}
			$slug = sanitize_key( $id );
			if ( '' === $slug || isset( $seen[ $slug ] ) ) {
				continue;
			}
			$seen[ $slug ]  = true;
			$dock_order[]    = $slug;
			if ( count( $dock_order ) >= 256 ) {
				break;
			}
		}
	}

	// dockPromotedPositions — map<sanitize_key, {x: int, y: int}>.
	// Persisted positions for synthetic dock-promoted placements, so
	// the JS synthesizer can restore the user's manual placement on
	// next reload. Capped at 256; absurd coordinates are dropped.
	$dock_promoted_positions = array();
	if ( isset( $raw['dockPromotedPositions'] ) && is_array( $raw['dockPromotedPositions'] ) ) {
		$count     = 0;
		$max_coord = 100000; // generous; real screens stop in the thousands.
		foreach ( $raw['dockPromotedPositions'] as $key => $val ) {
			if ( $count >= 256 ) {
				break;
			}
			if ( ! is_string( $key ) || '' === $key ) {
				continue;
			}
			$slug = sanitize_key( $key );
			if ( '' === $slug ) {
				continue;
			}
			if ( ! is_array( $val ) ) {
				continue;
			}
			if ( ! isset( $val['x'] ) || ! isset( $val['y'] ) ) {
				continue;
			}
			$x = is_numeric( $val['x'] ) ? (int) $val['x'] : null;
			$y = is_numeric( $val['y'] ) ? (int) $val['y'] : null;
			if ( null === $x || null === $y ) {
				continue;
			}
			if ( abs( $x ) > $max_coord || abs( $y ) > $max_coord ) {
				continue;
			}
			$dock_promoted_positions[ $slug ] = array( 'x' => $x, 'y' => $y );
			++$count;
		}
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
		'heartbeatRate'            => $heartbeat_rate,
		'nativePostsEnabled'       => $native_posts_enabled,
		'nativePostsHiddenColumns' => $native_posts_hidden_columns,
		'nativePagesEnabled'       => $native_pages_enabled,
		'nativeUsersEnabled'       => $native_users_enabled,
		'nativePluginsEnabled'     => $native_plugins_enabled,
		'nativeCommentsEnabled'    => $native_comments_enabled,
		'showDesktopOnWallpaperClick' => $show_desktop_on_wallpaper_click,
		'foldersSharingEnabled'    => $folders_sharing_enabled,
		'itemVisibility'           => $item_visibility,
		'dockOrder'                => $dock_order,
		'dockPromotedPositions'    => $dock_promoted_positions,
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

/**
 * Apply the per-user Heartbeat-rate preference to the
 * `heartbeat_settings` Core filter. WordPress reads these settings
 * once at page load to size both the initial AJAX interval and the
 * floor (`minimalInterval`) that prevents JS from speeding things
 * up. We mirror both so a 5-second rate actually fires every five
 * seconds (Core's default floor is 15).
 *
 * Only applies to users with Desktop Mode enabled — non-desktop
 * sessions keep Core's defaults. Anonymous requests skip too.
 *
 * @since 0.18.0
 *
 * @param array $settings Filtered Heartbeat settings.
 * @return array
 */
function desktop_mode_apply_heartbeat_rate_setting( $settings ) {
	if ( ! is_array( $settings ) ) {
		$settings = array();
	}
	$user_id = get_current_user_id();
	if ( $user_id <= 0 ) {
		return $settings;
	}
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled( $user_id ) ) {
		return $settings;
	}
	$os   = desktop_mode_get_os_settings( $user_id );
	$rate = isset( $os['heartbeatRate'] ) ? (int) $os['heartbeatRate'] : 0;
	if ( ! in_array( $rate, array( 15, 30, 45, 60 ), true ) ) {
		return $settings;
	}
	$settings['interval'] = $rate;
	return $settings;
}
add_filter( 'heartbeat_settings', 'desktop_mode_apply_heartbeat_rate_setting' );
