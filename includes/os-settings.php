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

/** Valid window-radius IDs — mirrors the TS `WINDOW_RADII` constant. */
const DESKTOP_MODE_OS_SETTINGS_WINDOW_RADII = array( 'sharp', 'default', 'round' );

/** Valid desktop-layout IDs — mirrors the TS `DESKTOP_LAYOUTS` constant. */
const DESKTOP_MODE_OS_SETTINGS_DESKTOP_LAYOUTS = array( 'classic', 'unified', 'spatial' );

/**
 * Returns a well-shaped default OS settings array.
 *
 * Mirrors the TypeScript `DEFAULTS` constant so a fresh user account
 * gets the same starting state in both environments.
 *
 * @return array
 */
function desktop_mode_default_os_settings() {
	return array(
		'wallpaper'                   => 'dark',
		'accent'                      => 'wp-blue',
		'dockSize'                    => 'default',
		'windowRadius'                => 'default',
		'desktopLayout'               => 'classic',
		'dockRailRenderer'            => 'default',
		// Active desktop-theme slug, or `''` for the system default.
		// Site-wide library (`includes/desktop-themes/`), per-user
		// activation. Not validated against the installed list here —
		// the enqueue path checks existence on every request, so a
		// deleted theme degrades silently instead of needing a
		// user-meta rewrite.
		'desktopTheme'                => '',
		'unfocusEffect'               => 'darken',
		// Window-link renderer id — how relation ties between windows
		// are drawn (see includes/window-links.php). `svg-splines` is
		// the shipped built-in; `none` disables the visuals.
		'windowLinkRenderer'          => 'svg-splines',
		// When the ties are visible: 'always' (default), 'focus' (only
		// while a group member is focused), or 'off'.
		'windowLinkVisibility'        => 'always',
		// Master switch for the window-links feature (OS Settings →
		// Features). Off unmounts the visuals AND the group behaviors
		// below; the style knobs above keep their values for when it
		// comes back on.
		'windowLinksEnabled'          => true,
		// Focusing a relation-group member raises its related windows
		// to just below it (silent restack, no focus theft).
		'windowLinkRaiseOnFocus'      => true,
		// Related windows of the focused member get a subtle outline.
		'windowLinkHighlight'         => true,
		'customGradient'              => array(
			'from'  => '#2271b1',
			'to'    => '#7c3aed',
			'angle' => 135,
		),
		'customImage'                 => null,
		// Per-wallpaper settings bags, keyed by wallpaper id — the
		// values a wallpaper's `renderConfig` dialog writes (e.g. the
		// Snow wallpaper's wind / particle count / flake size /
		// background). Scalar values only; the wallpaper owns the keys'
		// meaning. Missing ids mean "never configured" — the wallpaper
		// falls back to its defaults. Capped at 64 wallpapers × 32 keys.
		'wallpaperSettings'           => array(),
		'libraryHdOnly'               => true,
		'ai'                          => array(
			'enabled' => false,    // AI assistant is opt-in; enabled from OS Settings → Features once a provider is configured.
		),
		// Per-user opt-IN for the native Posts window. When true,
		// clicking the Posts dock tile opens the `<wpd-table>`-driven
		// native window instead of the chromeless `edit.php` iframe.
		// Default OFF — the native windows are opt-in
		// Beta. Fresh installs land on the classic iframe; users turn
		// this on in OS Settings → Features → Beta features to try it.
		// Per-user override of the WordPress Heartbeat interval, in
		// seconds. 60s matches Core's "idle" default; the allowed
		// rates (15/30/45/60) all sit at or above Core's 15 s
		// `minimalInterval` floor. See
		// `desktop_mode_apply_heartbeat_rate_setting` for the
		// `heartbeat_settings` filter that applies this.
		'heartbeatRate'               => 60,
		'nativePostsEnabled'          => false,
		// Per-user list of column keys hidden in the native Posts
		// window (e.g. array( 'author', 'tags' )). Empty array means
		// every column is visible. The sticky 'title' column is always
		// shown — the UI prevents toggling it.
		'nativePostsHiddenColumns'    => array(),
		// Per-user opt-IN for the native Pages window. Same posture as
		// nativePostsEnabled — defaults OFF (Beta), users opt in to swap
		// the classic `edit.php?post_type=page` iframe for the native UI.
		'nativePagesEnabled'          => false,
		// Per-user opt-IN for the native Users window. Defaults OFF
		// (Beta); the server-side cap gate (`list_users`) means the
		// toggle only matters for users who could see the Users tile.
		'nativeUsersEnabled'          => false,
		// Per-user opt-IN for the native Plugins window. Defaults OFF
		// (Beta); the server-side cap gate (`activate_plugins`) means
		// the toggle only matters for users who could see the Plugins
		// tile anyway. When `false`, the dock click uses the classic
		// `plugins.php` chromeless iframe path.
		'nativePluginsEnabled'        => false,
		// Per-user opt-IN for the native Comments window. Defaults OFF
		// (Beta); the server-side cap gate (`edit_posts`) means the
		// toggle only matters for users who could see the Comments tile.
		'nativeCommentsEnabled'       => false,
		// When true, left-clicking the empty wallpaper triggers the
		// "Show desktop" toggle (macOS-style) and the matching entry is
		// hidden from the wallpaper context menu. When false (default),
		// the entry stays in the menu and left clicks on the wallpaper
		// do nothing. Per-user.
		'showDesktopOnWallpaperClick' => false,
		// Diagonal corner ribbon on My WordPress tiles whose post
		// status isn't `publish` (draft / pending / private /
		// scheduled). On by default — surfaces unpublished work at
		// a glance. Per-user.
		'showPostStatusRibbons'       => true,
		// Unlocks developer-facing surfaces meant for plugin
		// authors: the Starter Widget appears in the add-widget
		// picker, and the OS Settings → Components tab runs its
		// intentional missing-import-warner demo. Off by default.
		// Per-user.
		'developerModeEnabled'        => false,
		// Per-user opt-OUT for the folder-sharing feature. Defaults
		// ON. When false:
		// - The Share button, share-settings modal, "Leave shared
		// folder" entry, and pending-invite prompt are all
		// suppressed in the user's shell.
		// - The heartbeat skips the `shares.pending` payload for
		// this user so they never see invites land.
		// - REST share routes return 404 for this user — they
		// can't list, invite, accept, deny, or leave.
		// Sites that don't want the feature (solo admin, no
		// collaborators) can flip the toggle and the surface
		// disappears without any database changes. The site-wide
		// "Delete folder sharing data" action in OS Settings →
		// Features → Advanced is a separate destructive cleanup.
		'foldersSharingEnabled'       => true,
		// Per-item placement preferences. Map of item id (dock-item
		// slug or registered desktop-icon id) → one of:
		// 'both'    — show on both dock and desktop.
		// 'dock'    — show only on the dock; hide from desktop.
		// 'desktop' — show only on the wallpaper; hide from dock.
		// 'hidden'  — hide from every shell surface.
		// Missing keys mean "no override" — items use their native rail.
		// Sanitized as map<sanitize_key, enum>. Capped at 256 entries.
		'itemVisibility'              => array(),
		// Per-user dock ordering. Ordered list of item ids; ids not in
		// the list keep their server-supplied position appended after
		// the listed ones. Unknown ids are tolerated.
		'dockOrder'                   => array(),
		// Persisted desktop position for every dock item the user has
		// promoted to the wallpaper via `itemVisibility[id]=desktop|both`.
		// Keyed by item id, value is `{ x: int, y: int }`. The JS
		// synthesizer reads this when building a synthetic placement so
		// the icon lands where the user last dragged it instead of
		// resetting to (0, 0) on every reload. Capped at 256 entries.
		'dockPromotedPositions'       => array(),
	);
}

/**
 * Retrieves the saved OS settings for a user.
 *
 * Always returns a fully-shaped array so the JS side doesn't need to
 * defend against partial or missing keys.
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

	// Window radius — must be one of the three known values.
	$window_radius = isset( $raw['windowRadius'] ) && in_array( $raw['windowRadius'], DESKTOP_MODE_OS_SETTINGS_WINDOW_RADII, true )
		? (string) $raw['windowRadius']
		: $defaults['windowRadius'];

	// Desktop layout — must be one of the three known values
	// (`classic`, `unified`, `spatial`). Default `classic`.
	$desktop_layout = isset( $raw['desktopLayout'] )
		&& in_array( $raw['desktopLayout'], DESKTOP_MODE_OS_SETTINGS_DESKTOP_LAYOUTS, true )
		? (string) $raw['desktopLayout']
		: $defaults['desktopLayout'];

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

	// Desktop theme slug — a pattern check, NOT an allow-list, the
	// same idiom as `dockRailRenderer` above. Validating against the
	// installed-theme option here would load (and unserialize) that
	// option on every single settings write for a value the enqueue
	// path re-checks anyway. `''` is the system default and is a
	// legitimate value, so an empty/absent key keeps the default.
	$desktop_theme = $defaults['desktopTheme'];
	if ( isset( $raw['desktopTheme'] ) && is_string( $raw['desktopTheme'] ) ) {
		$desktop_theme = sanitize_key( $raw['desktopTheme'] );
	}

	// Unfocus effect id — accept the `none` sentinel or any registry id.
	// Effect ids mirror the JS registry pattern `^[a-z0-9_/-]+$` (slashes
	// allowed for `vendor/sub-id` namespacing), so we lower-case and strip
	// to that charset rather than using sanitize_key() (which would drop
	// the slash and break a namespaced id on round-trip). No allow-list:
	// the JS engine resolves at use time and treats an unknown id as "no
	// effect".
	$unfocus_effect = $defaults['unfocusEffect'];
	if ( isset( $raw['unfocusEffect'] ) && is_string( $raw['unfocusEffect'] ) ) {
		$slug = preg_replace( '/[^a-z0-9_\/-]/', '', strtolower( $raw['unfocusEffect'] ) );
		if ( '' !== $slug ) {
			$unfocus_effect = $slug;
		}
	}

	// Window-link renderer id — same id charset as unfocus effects
	// (slashes allowed for `vendor/sub-id`). No allow-list: the JS
	// render host resolves at use time and falls back to the built-in
	// `svg-splines` when the picked renderer isn't registered.
	$window_link_renderer = $defaults['windowLinkRenderer'];
	if ( isset( $raw['windowLinkRenderer'] ) && is_string( $raw['windowLinkRenderer'] ) ) {
		$slug = preg_replace( '/[^a-z0-9_\/-]/', '', strtolower( $raw['windowLinkRenderer'] ) );
		if ( '' !== $slug ) {
			$window_link_renderer = $slug;
		}
	}

	// Window-link visibility — small closed set.
	$window_link_visibility = $defaults['windowLinkVisibility'];
	if (
		isset( $raw['windowLinkVisibility'] )
		&& in_array( $raw['windowLinkVisibility'], array( 'focus', 'always', 'off' ), true )
	) {
		$window_link_visibility = $raw['windowLinkVisibility'];
	}

	// Window-links feature switches — plain booleans.
	$window_links_enabled = isset( $raw['windowLinksEnabled'] )
		? (bool) $raw['windowLinksEnabled']
		: $defaults['windowLinksEnabled'];

	$window_link_raise_on_focus = isset( $raw['windowLinkRaiseOnFocus'] )
		? (bool) $raw['windowLinkRaiseOnFocus']
		: $defaults['windowLinkRaiseOnFocus'];

	$window_link_highlight = isset( $raw['windowLinkHighlight'] )
		? (bool) $raw['windowLinkHighlight']
		: $defaults['windowLinkHighlight'];

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
		$ci     = $raw['customImage'];
		$ci_id  = isset( $ci['id'] ) && is_numeric( $ci['id'] ) ? (int) $ci['id'] : 0;
		$ci_url = isset( $ci['url'] ) ? esc_url_raw( (string) $ci['url'] ) : '';
		if ( $ci_id > 0 && '' !== $ci_url && preg_match( '/^https?:\/\//i', $ci_url ) ) {
			$custom_image = array(
				'id'  => $ci_id,
				'url' => $ci_url,
			);
		}
	}

	// wallpaperSettings — map<wallpaper id, map<key, scalar>>. Wallpaper
	// ids follow the same charset as unfocus-effect ids (slashes allowed
	// for `vendor/sub-id` namespacing); setting keys follow the JS
	// identifier-ish charset wallpaper authors use (camelCase, hyphens,
	// underscores). Values must be scalar — booleans and numbers pass
	// through typed, strings are sanitized and length-capped. Unknown
	// wallpaper ids are kept (a deactivated wallpaper plugin's settings
	// should survive reactivation). Capped at 64 ids × 32 keys.
	$wallpaper_settings = array();
	if ( isset( $raw['wallpaperSettings'] ) && is_array( $raw['wallpaperSettings'] ) ) {
		$id_count = 0;
		foreach ( $raw['wallpaperSettings'] as $wp_id => $bag ) {
			if ( $id_count >= 64 ) {
				break;
			}
			if ( ! is_string( $wp_id ) || '' === $wp_id || ! is_array( $bag ) ) {
				continue;
			}
			$wp_slug = preg_replace( '/[^a-z0-9_\/-]/', '', strtolower( $wp_id ) );
			if ( '' === $wp_slug ) {
				continue;
			}
			$clean_bag = array();
			$key_count = 0;
			foreach ( $bag as $key => $value ) {
				if ( $key_count >= 32 ) {
					break;
				}
				if ( ! is_string( $key ) || '' === $key || ! preg_match( '/^[a-zA-Z0-9_-]+$/', $key ) ) {
					continue;
				}
				if ( is_bool( $value ) ) {
					$clean_bag[ $key ] = $value;
				} elseif ( is_int( $value ) || is_float( $value ) ) {
					if ( ! is_finite( (float) $value ) ) {
						continue;
					}
					$clean_bag[ $key ] = $value;
				} elseif ( is_string( $value ) ) {
					$clean_bag[ $key ] = mb_substr( sanitize_text_field( $value ), 0, 256 );
				} else {
					continue;
				}
				++$key_count;
			}
			if ( empty( $clean_bag ) ) {
				continue;
			}
			$wallpaper_settings[ $wp_slug ] = $clean_bag;
			++$id_count;
		}
	}

	// Library HD only — boolean.
	$library_hd_only = isset( $raw['libraryHdOnly'] ) ? (bool) $raw['libraryHdOnly'] : $defaults['libraryHdOnly'];

	// AI settings — just the per-user on/off toggle. Provider + model selection
	// is delegated to the Core AI Client, so there is no preference to persist.
	$ai = $defaults['ai'];
	if ( isset( $raw['ai'] ) && is_array( $raw['ai'] ) ) {
		$raw_ai = $raw['ai'];

		if ( isset( $raw_ai['enabled'] ) ) {
			$ai['enabled'] = (bool) $raw_ai['enabled'];
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

	$show_post_status_ribbons = isset( $raw['showPostStatusRibbons'] )
		? (bool) $raw['showPostStatusRibbons']
		: $defaults['showPostStatusRibbons'];

	$developer_mode_enabled = isset( $raw['developerModeEnabled'] )
		? (bool) $raw['developerModeEnabled']
		: $defaults['developerModeEnabled'];

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

	// dockOrder — ordered list of item ids. Most are sanitize_key()-
	// clean dock slugs, but cross-rail tiles the user promoted carry a
	// rail-synthesis prefix (`desktop:<id>` / `dock:<id>`, built by
	// src/settings/item-placement.ts). sanitize_key() strips the colon,
	// which silently breaks the JS order match on reload and can collide
	// with an unrelated id — so allow the colon (and hyphen/underscore)
	// while still rejecting anything outside the JS id charset.
	$dock_order = array();
	if ( isset( $raw['dockOrder'] ) && is_array( $raw['dockOrder'] ) ) {
		$seen = array();
		foreach ( $raw['dockOrder'] as $id ) {
			if ( ! is_string( $id ) || '' === $id ) {
				continue;
			}
			$slug = (string) preg_replace( '/[^a-z0-9_:-]+/', '', strtolower( $id ) );
			if ( '' === $slug || isset( $seen[ $slug ] ) ) {
				continue;
			}
			$seen[ $slug ] = true;
			$dock_order[]  = $slug;
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
			$dock_promoted_positions[ $slug ] = array(
				'x' => $x,
				'y' => $y,
			);
			++$count;
		}
	}

	return array(
		'wallpaper'                   => $wallpaper,
		'accent'                      => $accent,
		'dockSize'                    => $dock_size,
		'windowRadius'                => $window_radius,
		'desktopLayout'               => $desktop_layout,
		'dockRailRenderer'            => $dock_rail_renderer,
		'desktopTheme'                => $desktop_theme,
		'unfocusEffect'               => $unfocus_effect,
		'windowLinkRenderer'          => $window_link_renderer,
		'windowLinkVisibility'        => $window_link_visibility,
		'windowLinksEnabled'          => $window_links_enabled,
		'windowLinkRaiseOnFocus'      => $window_link_raise_on_focus,
		'windowLinkHighlight'         => $window_link_highlight,
		'customGradient'              => $custom_gradient,
		'customImage'                 => $custom_image,
		'wallpaperSettings'           => $wallpaper_settings,
		'libraryHdOnly'               => $library_hd_only,
		'ai'                          => $ai,
		'heartbeatRate'               => $heartbeat_rate,
		'nativePostsEnabled'          => $native_posts_enabled,
		'nativePostsHiddenColumns'    => $native_posts_hidden_columns,
		'nativePagesEnabled'          => $native_pages_enabled,
		'nativeUsersEnabled'          => $native_users_enabled,
		'nativePluginsEnabled'        => $native_plugins_enabled,
		'nativeCommentsEnabled'       => $native_comments_enabled,
		'showDesktopOnWallpaperClick' => $show_desktop_on_wallpaper_click,
		'showPostStatusRibbons'       => $show_post_status_ribbons,
		'developerModeEnabled'        => $developer_mode_enabled,
		'foldersSharingEnabled'       => $folders_sharing_enabled,
		'itemVisibility'              => $item_visibility,
		'dockOrder'                   => $dock_order,
		'dockPromotedPositions'       => $dock_promoted_positions,
	);
}

/**
 * Registers the REST routes for OS settings.
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
 * Requires the caller to be logged in *and* have desktop mode enabled —
 * see {@see desktop_mode_rest_require_enabled()} for why `read` alone is
 * insufficient.
 *
 * @return true|WP_Error
 */
function desktop_mode_rest_os_settings_permission() {
	return desktop_mode_rest_require_enabled();
}

/**
 * GET /desktop-mode/v1/os-settings
 *
 * @return WP_REST_Response
 */
function desktop_mode_rest_get_os_settings() {
	return rest_ensure_response( desktop_mode_get_os_settings( get_current_user_id() ) );
}

/**
 * POST /desktop-mode/v1/os-settings
 *
 * @param WP_REST_Request $request The REST request.
 * @return WP_REST_Response The saved settings (after sanitization).
 */
function desktop_mode_rest_save_os_settings( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$payload = $request->get_param( 'settings' );
	desktop_mode_save_os_settings( $user_id, $payload );
	return rest_ensure_response( desktop_mode_get_os_settings( $user_id ) );
}

/**
 * Apply the per-user Heartbeat-rate preference to the
 * `heartbeat_settings` Core filter. WordPress reads these settings
 * once at page load. We set `interval` only; the allowed rates
 * (15/30/45/60 s) all sit at or above Core's 15 s
 * `minimalInterval` floor, so the floor never needs overriding.
 *
 * Only applies to users with Desktop Mode enabled — non-desktop
 * sessions keep Core's defaults. Anonymous requests skip too.
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
