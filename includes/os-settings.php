<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_OS_SETTINGS_META_KEY = 'desktop_mode_os_settings';

const OPENSTATION_OS_SETTINGS_DOCK_SIZES = array( 'compact', 'default', 'large' );

const OPENSTATION_OS_SETTINGS_WINDOW_RADII = array( 'sharp', 'default', 'round' );

const OPENSTATION_OS_SETTINGS_OPEN_WINDOWS_AS = array( 'default', 'maximized', 'focused' );

const OPENSTATION_OS_SETTINGS_ADMIN_BAR_MODES = array( 'static', 'dynamic', 'hidden' );

const OPENSTATION_OS_SETTINGS_DESKTOP_LAYOUTS = array( 'classic', 'unified' );

const OPENSTATION_OS_SETTINGS_DOCK_PLACEMENTS = array( 'bottom', 'left', 'right' );

const OPENSTATION_OS_SETTINGS_DOCK_BEHAVIORS = array( 'static', 'dynamic' );

const OPENSTATION_OS_SETTINGS_MOBILE_LAYOUTS = array( 'auto', 'desktop', 'mobile' );

const OPENSTATION_OS_SETTINGS_MOBILE_TABS_MAX = 3;

const OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MIN = 80;
const OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MAX = 4000;

function openstation_default_os_settings() {
	return array(
		'wallpaper'                   => 'galaxy',

		'accent'                      => 'pulse',

		'customAccent'                => '#f252fc',
		'dockSize'                    => 'default',

		'windowRadius'                => 'round',
		'openWindowsAs'               => 'default',

		'adminBarMode'                => 'hidden',

		'dockBehavior'                => 'static',

		'sideDockBehavior'            => 'static',

		'desktopLayout'               => 'unified',

		'dockPlacement'               => 'bottom',
		'dockRailRenderer'            => 'default',

		'desktopTheme'                => '',

		'appliedThemeRecommendations' => array(),
		'unfocusEffect'               => 'darken',

		'windowReveal'                => 'none',

		'windowRevealDuration'        => 0,

		'windowLinkRenderer'          => 'svg-splines',

		'windowLinkVisibility'        => 'always',

		'windowLinksEnabled'          => true,

		'windowLinkRaiseOnFocus'      => true,

		'windowLinkHighlight'         => true,
		'customGradient'              => array(
			'from'  => '#2271b1',
			'to'    => '#7c3aed',
			'angle' => 135,
		),
		'customImage'                 => null,

		'wallpaperSettings'           => array(),
		'libraryHdOnly'               => true,
		'ai'                          => array(
			'enabled' => false,
		),

		'heartbeatRate'               => 60,
		'nativePostsEnabled'          => false,

		'nativePostsHiddenColumns'    => array(),

		'nativePagesHiddenColumns'    => array(),

		'nativePagesEnabled'          => false,

		'nativeUsersEnabled'          => false,

		'nativePluginsEnabled'        => false,

		'nativeCommentsEnabled'       => false,

		'stationHomeEnabled'          => false,

		'adminAssetCacheEnabled'      => true,
		'windowPrewarmEnabled'        => true,

		'showDesktopOnWallpaperClick' => false,

		'confirmCloseAllWindows'      => true,

		'mioEnabled'                  => false,
		'mioApiEnabled'               => false,
		'mioShowOnWallpaper'          => true,

		'mioStyle'                    => array(
			'appearance' => array(),
			'physics'    => array(),
		),

		'showPostStatusRibbons'       => true,

		'developerModeEnabled'        => false,

		'foldersSharingEnabled'       => true,

		'navPlacement'                => array(),

		'navOrder'                    => array(),

		'mobileLayout'                => 'auto',

		'mobileTabs'                  => array(),

		'dockPromotedPositions'       => array(),
	);
}

function openstation_get_os_settings( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return openstation_sanitize_os_settings( array() );
	}

	$raw = get_user_meta( $user_id, OPENSTATION_OS_SETTINGS_META_KEY, true );
	if ( ! is_array( $raw ) ) {
		return openstation_sanitize_os_settings( array() );
	}

	return openstation_sanitize_os_settings( $raw );
}

function openstation_save_os_settings( $user_id, $settings ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}

	$clean = openstation_sanitize_os_settings( $settings );
	return false !== update_user_meta( $user_id, OPENSTATION_OS_SETTINGS_META_KEY, $clean );
}

function openstation_canonical_nav_id( $id ) {
	$id = (string) $id;
	if ( 0 === strpos( $id, 'dock:' ) ) {
		return substr( $id, 5 );
	}
	if ( 0 === strpos( $id, 'desktop:' ) ) {
		return substr( $id, 8 );
	}
	return $id;
}

function openstation_migrate_item_visibility( $visibility ) {
	$map = array(
		'dock'    => 'rail',
		'desktop' => 'desktop',
		'both'    => 'both',
		'hidden'  => 'hidden',
	);

	$out = array();
	foreach ( (array) $visibility as $key => $val ) {
		if ( ! is_string( $key ) || ! is_string( $val ) || ! isset( $map[ $val ] ) ) {
			continue;
		}
		$id = openstation_canonical_nav_id( $key );
		if ( '' === $id ) {
			continue;
		}

		if ( $id === $key || ! isset( $out[ $id ] ) ) {
			$out[ $id ] = $map[ $val ];
		}
	}
	return $out;
}

function openstation_sanitize_os_settings( $raw ) {
	$defaults = openstation_default_os_settings();

	if ( ! is_array( $raw ) ) {
		$raw = array();
	}

	$wallpaper = isset( $raw['wallpaper'] ) && is_string( $raw['wallpaper'] ) && '' !== $raw['wallpaper']
		? sanitize_key( $raw['wallpaper'] )
		: $defaults['wallpaper'];

	$accent = isset( $raw['accent'] ) && is_string( $raw['accent'] ) && '' !== $raw['accent']
		? sanitize_key( $raw['accent'] )
		: $defaults['accent'];

	$custom_accent = isset( $raw['customAccent'] )
		&& is_string( $raw['customAccent'] )
		&& preg_match( '/^#[0-9a-fA-F]{6}$/', $raw['customAccent'] )
		? strtolower( $raw['customAccent'] )
		: $defaults['customAccent'];

	$dock_size = isset( $raw['dockSize'] ) && in_array( $raw['dockSize'], OPENSTATION_OS_SETTINGS_DOCK_SIZES, true )
		? (string) $raw['dockSize']
		: $defaults['dockSize'];

	$window_radius = isset( $raw['windowRadius'] ) && in_array( $raw['windowRadius'], OPENSTATION_OS_SETTINGS_WINDOW_RADII, true )
		? (string) $raw['windowRadius']
		: $defaults['windowRadius'];

	$open_windows_as = isset( $raw['openWindowsAs'] ) && in_array( $raw['openWindowsAs'], OPENSTATION_OS_SETTINGS_OPEN_WINDOWS_AS, true )
		? (string) $raw['openWindowsAs']
		: $defaults['openWindowsAs'];

	$admin_bar_mode = isset( $raw['adminBarMode'] )
		&& in_array( $raw['adminBarMode'], OPENSTATION_OS_SETTINGS_ADMIN_BAR_MODES, true )
		? (string) $raw['adminBarMode']
		: $defaults['adminBarMode'];

	$dock_behavior = isset( $raw['dockBehavior'] )
		&& in_array( $raw['dockBehavior'], OPENSTATION_OS_SETTINGS_DOCK_BEHAVIORS, true )
		? (string) $raw['dockBehavior']
		: $defaults['dockBehavior'];
	$side_dock_behavior = isset( $raw['sideDockBehavior'] )
		&& in_array( $raw['sideDockBehavior'], OPENSTATION_OS_SETTINGS_DOCK_BEHAVIORS, true )
		? (string) $raw['sideDockBehavior']
		: $defaults['sideDockBehavior'];

	$desktop_layout = isset( $raw['desktopLayout'] )
		&& in_array( $raw['desktopLayout'], OPENSTATION_OS_SETTINGS_DESKTOP_LAYOUTS, true )
		? (string) $raw['desktopLayout']
		: $defaults['desktopLayout'];

	$dock_placement = isset( $raw['dockPlacement'] )
		&& in_array( $raw['dockPlacement'], OPENSTATION_OS_SETTINGS_DOCK_PLACEMENTS, true )
		? (string) $raw['dockPlacement']
		: $defaults['dockPlacement'];

	$dock_rail_renderer = $defaults['dockRailRenderer'];
	if ( isset( $raw['dockRailRenderer'] ) && is_string( $raw['dockRailRenderer'] ) ) {
		$slug = sanitize_key( $raw['dockRailRenderer'] );
		if ( '' !== $slug ) {
			$dock_rail_renderer = $slug;
		}
	}

	$desktop_theme = $defaults['desktopTheme'];
	if ( isset( $raw['desktopTheme'] ) && is_string( $raw['desktopTheme'] ) ) {
		$desktop_theme = sanitize_key( $raw['desktopTheme'] );
	}

	$applied_theme_recommendations = $defaults['appliedThemeRecommendations'];
	if ( isset( $raw['appliedThemeRecommendations'] ) && is_array( $raw['appliedThemeRecommendations'] ) ) {
		$applied_theme_recommendations = array();
		foreach ( $raw['appliedThemeRecommendations'] as $theme_slug ) {
			if ( ! is_string( $theme_slug ) || '' === $theme_slug ) {
				continue;
			}
			$theme_slug = sanitize_key( $theme_slug );
			if ( '' === $theme_slug ) {
				continue;
			}
			$applied_theme_recommendations[] = $theme_slug;
		}

		$applied_theme_recommendations = array_slice(
			array_values( array_unique( $applied_theme_recommendations ) ),
			-64
		);
	}

	$unfocus_effect = $defaults['unfocusEffect'];
	if ( isset( $raw['unfocusEffect'] ) && is_string( $raw['unfocusEffect'] ) ) {
		$slug = preg_replace( '/[^a-z0-9_\/-]/', '', strtolower( $raw['unfocusEffect'] ) );
		if ( '' !== $slug ) {
			$unfocus_effect = $slug;
		}
	}

	$window_reveal = $defaults['windowReveal'];
	if ( isset( $raw['windowReveal'] ) && is_string( $raw['windowReveal'] ) ) {
		$slug = preg_replace( '/[^a-z0-9_\/-]/', '', strtolower( $raw['windowReveal'] ) );
		if ( '' !== $slug ) {
			$window_reveal = $slug;
		}
	}

	$window_reveal_duration = $defaults['windowRevealDuration'];
	if ( isset( $raw['windowRevealDuration'] ) && is_numeric( $raw['windowRevealDuration'] ) ) {
		$requested = (int) round( (float) $raw['windowRevealDuration'] );
		if ( $requested > 0 ) {
			$window_reveal_duration = max(
				OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MIN,
				min( OPENSTATION_OS_SETTINGS_REVEAL_DURATION_MAX, $requested )
			);
		} else {
			$window_reveal_duration = 0;
		}
	}

	$window_link_renderer = $defaults['windowLinkRenderer'];
	if ( isset( $raw['windowLinkRenderer'] ) && is_string( $raw['windowLinkRenderer'] ) ) {
		$slug = preg_replace( '/[^a-z0-9_\/-]/', '', strtolower( $raw['windowLinkRenderer'] ) );
		if ( '' !== $slug ) {
			$window_link_renderer = $slug;
		}
	}

	$window_link_visibility = $defaults['windowLinkVisibility'];
	if (
		isset( $raw['windowLinkVisibility'] )
		&& in_array( $raw['windowLinkVisibility'], array( 'focus', 'always', 'off' ), true )
	) {
		$window_link_visibility = $raw['windowLinkVisibility'];
	}

	$window_links_enabled = isset( $raw['windowLinksEnabled'] )
		? (bool) $raw['windowLinksEnabled']
		: $defaults['windowLinksEnabled'];

	$window_link_raise_on_focus = isset( $raw['windowLinkRaiseOnFocus'] )
		? (bool) $raw['windowLinkRaiseOnFocus']
		: $defaults['windowLinkRaiseOnFocus'];

	$window_link_highlight = isset( $raw['windowLinkHighlight'] )
		? (bool) $raw['windowLinkHighlight']
		: $defaults['windowLinkHighlight'];

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

	$library_hd_only = isset( $raw['libraryHdOnly'] ) ? (bool) $raw['libraryHdOnly'] : $defaults['libraryHdOnly'];

	$ai = $defaults['ai'];
	if ( isset( $raw['ai'] ) && is_array( $raw['ai'] ) ) {
		$raw_ai = $raw['ai'];

		if ( isset( $raw_ai['enabled'] ) ) {
			$ai['enabled'] = (bool) $raw_ai['enabled'];
		}
	}

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

		$native_posts_hidden_columns = array_slice( array_values( array_unique( $native_posts_hidden_columns ) ), 0, 32 );
	}

	$native_pages_hidden_columns = $defaults['nativePagesHiddenColumns'];
	if ( isset( $raw['nativePagesHiddenColumns'] ) && is_array( $raw['nativePagesHiddenColumns'] ) ) {
		$native_pages_hidden_columns = array();
		foreach ( $raw['nativePagesHiddenColumns'] as $col ) {
			if ( ! is_string( $col ) || '' === $col ) {
				continue;
			}
			$slug = sanitize_key( $col );
			if ( '' === $slug ) {
				continue;
			}
			$native_pages_hidden_columns[] = $slug;
		}

		$native_pages_hidden_columns = array_slice( array_values( array_unique( $native_pages_hidden_columns ) ), 0, 32 );
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

	$station_home_enabled = isset( $raw['stationHomeEnabled'] )
		? (bool) $raw['stationHomeEnabled']
		: $defaults['stationHomeEnabled'];

	$extended_options          = openstation_get_extended_options();
	$admin_asset_cache_enabled = $extended_options['admin_asset_cache'];
	$window_prewarm_enabled    = $extended_options['window_prewarm'];

	$show_desktop_on_wallpaper_click = isset( $raw['showDesktopOnWallpaperClick'] )
		? (bool) $raw['showDesktopOnWallpaperClick']
		: $defaults['showDesktopOnWallpaperClick'];

	$confirm_close_all_windows = isset( $raw['confirmCloseAllWindows'] )
		? (bool) $raw['confirmCloseAllWindows']
		: $defaults['confirmCloseAllWindows'];

	$mio_enabled = isset( $raw['mioEnabled'] )
		? (bool) $raw['mioEnabled']
		: ( isset( $raw['mioApiEnabled'] ) ? (bool) $raw['mioApiEnabled'] : $defaults['mioEnabled'] );

	$mio_style = openstation_sanitize_mio_look(
		isset( $raw['mioStyle'] ) ? $raw['mioStyle'] : null
	);

	$show_post_status_ribbons = isset( $raw['showPostStatusRibbons'] )
		? (bool) $raw['showPostStatusRibbons']
		: $defaults['showPostStatusRibbons'];

	$developer_mode_enabled = isset( $raw['developerModeEnabled'] )
		? (bool) $raw['developerModeEnabled']
		: $defaults['developerModeEnabled'];

	$mobile_layout = isset( $raw['mobileLayout'] )
		&& in_array( $raw['mobileLayout'], OPENSTATION_OS_SETTINGS_MOBILE_LAYOUTS, true )
		? (string) $raw['mobileLayout']
		: $defaults['mobileLayout'];

	$mobile_tabs = array();
	if ( isset( $raw['mobileTabs'] ) && is_array( $raw['mobileTabs'] ) ) {
		$seen_tabs = array();
		foreach ( $raw['mobileTabs'] as $id ) {
			if ( ! is_string( $id ) || '' === $id ) {
				continue;
			}
			$slug = sanitize_key( openstation_canonical_nav_id( $id ) );
			if ( '' === $slug || isset( $seen_tabs[ $slug ] ) ) {
				continue;
			}
			$seen_tabs[ $slug ] = true;
			$mobile_tabs[]      = $slug;
			if ( count( $mobile_tabs ) >= OPENSTATION_OS_SETTINGS_MOBILE_TABS_MAX ) {
				break;
			}
		}
	}

	$folders_sharing_enabled = isset( $raw['foldersSharingEnabled'] )
		? (bool) $raw['foldersSharingEnabled']
		: $defaults['foldersSharingEnabled'];

	$raw_placement = array();
	if ( isset( $raw['navPlacement'] ) && is_array( $raw['navPlacement'] ) ) {
		$raw_placement = $raw['navPlacement'];
	} elseif ( isset( $raw['itemVisibility'] ) && is_array( $raw['itemVisibility'] ) ) {
		$raw_placement = openstation_migrate_item_visibility( $raw['itemVisibility'] );
	}

	$nav_placement = array();
	if ( ! empty( $raw_placement ) ) {
		$allowed_placements = array( 'both', 'rail', 'desktop', 'hidden' );
		$count              = 0;
		foreach ( $raw_placement as $key => $val ) {
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
			$nav_placement[ $slug ] = $val;
			++$count;
		}
	}

	$raw_order = array();
	if ( isset( $raw['navOrder'] ) && is_array( $raw['navOrder'] ) ) {
		$raw_order = $raw['navOrder'];
	} elseif ( isset( $raw['dockOrder'] ) && is_array( $raw['dockOrder'] ) ) {
		$raw_order = $raw['dockOrder'];
	}

	$nav_order = array();
	if ( ! empty( $raw_order ) ) {
		$seen = array();
		foreach ( $raw_order as $id ) {
			if ( ! is_string( $id ) || '' === $id ) {
				continue;
			}
			$slug = sanitize_key( openstation_canonical_nav_id( $id ) );
			if ( '' === $slug || isset( $seen[ $slug ] ) ) {
				continue;
			}
			$seen[ $slug ] = true;
			$nav_order[]   = $slug;
			if ( count( $nav_order ) >= 256 ) {
				break;
			}
		}
	}

	$dock_promoted_positions = array();
	if ( isset( $raw['dockPromotedPositions'] ) && is_array( $raw['dockPromotedPositions'] ) ) {
		$count     = 0;
		$max_coord = 100000;
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
		'customAccent'                => $custom_accent,
		'dockSize'                    => $dock_size,
		'windowRadius'                => $window_radius,
		'openWindowsAs'               => $open_windows_as,
		'adminBarMode'                => $admin_bar_mode,
		'desktopLayout'               => $desktop_layout,
		'dockPlacement'               => $dock_placement,
		'dockBehavior'                => $dock_behavior,
		'sideDockBehavior'            => $side_dock_behavior,
		'dockRailRenderer'            => $dock_rail_renderer,
		'desktopTheme'                => $desktop_theme,
		'appliedThemeRecommendations' => $applied_theme_recommendations,
		'unfocusEffect'               => $unfocus_effect,
		'windowReveal'                => $window_reveal,
		'windowRevealDuration'        => $window_reveal_duration,
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
		'nativePagesHiddenColumns'    => $native_pages_hidden_columns,
		'nativeUsersEnabled'          => $native_users_enabled,
		'nativePluginsEnabled'        => $native_plugins_enabled,
		'nativeCommentsEnabled'       => $native_comments_enabled,
		'stationHomeEnabled'          => $station_home_enabled,
		'adminAssetCacheEnabled'      => $admin_asset_cache_enabled,
		'windowPrewarmEnabled'        => $window_prewarm_enabled,
		'showDesktopOnWallpaperClick' => $show_desktop_on_wallpaper_click,
		'confirmCloseAllWindows'      => $confirm_close_all_windows,
		'mioEnabled'                  => $mio_enabled,
		'mioApiEnabled'               => $mio_enabled,
		'mioShowOnWallpaper'          => isset( $raw['mioShowOnWallpaper'] ) ? (bool) $raw['mioShowOnWallpaper'] : $defaults['mioShowOnWallpaper'],
		'mioStyle'                    => $mio_style,
		'showPostStatusRibbons'       => $show_post_status_ribbons,
		'developerModeEnabled'        => $developer_mode_enabled,
		'foldersSharingEnabled'       => $folders_sharing_enabled,
		'navPlacement'                => $nav_placement,
		'navOrder'                    => $nav_order,
		'mobileLayout'                => $mobile_layout,
		'mobileTabs'                  => $mobile_tabs,
		'dockPromotedPositions'       => $dock_promoted_positions,
	);
}

function openstation_register_os_settings_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/os-settings',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_rest_get_os_settings',
				'permission_callback' => 'openstation_rest_os_settings_permission',
			),
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'openstation_rest_save_os_settings',
				'permission_callback' => 'openstation_rest_os_settings_permission',
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
add_action( 'rest_api_init', 'openstation_register_os_settings_rest_routes' );

function openstation_rest_os_settings_permission() {
	return openstation_rest_require_enabled();
}

function openstation_rest_get_os_settings() {
	return rest_ensure_response( openstation_get_os_settings( get_current_user_id() ) );
}

function openstation_rest_save_os_settings( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$payload = $request->get_param( 'settings' );

	if ( ! is_array( $payload ) ) {
		return rest_ensure_response( openstation_get_os_settings( $user_id ) );
	}

	if ( ! array_key_exists( 'mioEnabled', $payload ) && array_key_exists( 'mioApiEnabled', $payload ) ) {
		$payload['mioEnabled'] = $payload['mioApiEnabled'];
	}

	openstation_save_os_settings(
		$user_id,
		array_merge( openstation_get_os_settings( $user_id ), $payload )
	);
	return rest_ensure_response( openstation_get_os_settings( $user_id ) );
}

function openstation_apply_heartbeat_rate_setting( $settings ) {
	if ( ! is_array( $settings ) ) {
		$settings = array();
	}
	$user_id = get_current_user_id();
	if ( $user_id <= 0 ) {
		return $settings;
	}
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled( $user_id ) ) {
		return $settings;
	}
	$os   = openstation_get_os_settings( $user_id );
	$rate = isset( $os['heartbeatRate'] ) ? (int) $os['heartbeatRate'] : 0;
	if ( ! in_array( $rate, array( 15, 30, 45, 60 ), true ) ) {
		return $settings;
	}
	$settings['interval'] = $rate;
	return $settings;
}
add_filter( 'heartbeat_settings', 'openstation_apply_heartbeat_rate_setting' );
