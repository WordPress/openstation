<?php
/**
 * OpenStation — Desktop-theme enqueue + body class + shell config.
 *
 * **Zero cost when no theme is active.** Every entry point here
 * early-returns on an empty selection before it reads an option,
 * touches the filesystem, or registers a handle. A site whose users
 * all sit on "System default" pays one user-meta read that the OS
 * settings layer was doing anyway.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Style handle for the compiled desktop-theme stylesheet. */
const OPEN_STATION_DESKTOP_THEME_STYLE_HANDLE = 'os-desktop-theme';

/**
 * Resolve the desktop theme a user has selected, if it still exists.
 *
 * Orphans degrade silently: a user whose selected theme was deleted
 * (or whose registering plugin was deactivated) gets `''` here and
 * sees the system default, with no user-meta rewrite and no error.
 *
 * @param int $user_id User id. Defaults to the current user.
 * @return string Slug, or `''` for the system default.
 */
function open_station_active_desktop_theme_slug( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}
	if ( $user_id <= 0 ) {
		return '';
	}

	$settings = open_station_get_os_settings( $user_id );
	$slug     = isset( $settings['desktopTheme'] ) ? sanitize_key( (string) $settings['desktopTheme'] ) : '';
	if ( '' === $slug ) {
		return '';
	}

	// Existence check across both sources. This is the safety net
	// that lets the os-settings sanitizer stay a cheap pattern check
	// instead of loading the themes option on every settings write.
	if ( null !== open_station_desktop_theme_get( $slug ) ) {
		return $slug;
	}
	if ( null !== open_station_desktop_theme_registry( $slug ) ) {
		return $slug;
	}
	return '';
}

/**
 * Whether this request should carry desktop-theme assets at all.
 *
 * @internal
 *
 * @return bool
 */
function open_station_desktop_theme_request_is_themable() {
	return open_station_is_enabled()
		&& ! open_station_is_chromeless_request()
		&& ! open_station_is_classic_request();
}

/**
 * Enqueue the active theme's compiled stylesheet.
 *
 * The `os-variables` dependency is load-bearing, not
 * decoration: the compiled selectors weigh the same as the
 * per-admin-color-scheme blocks in `variables.css`, and a
 * specificity tie is settled by source order. Drop the dependency
 * and a themed token silently loses to the color scheme.
 */
function open_station_enqueue_desktop_theme_style() {
	if ( ! open_station_desktop_theme_request_is_themable() ) {
		return;
	}
	$slug = open_station_active_desktop_theme_slug();
	if ( '' === $slug ) {
		// The whole point: nothing registered, nothing enqueued, no
		// extra request, no extra bytes.
		return;
	}

	$uploaded = open_station_desktop_theme_get( $slug );
	if ( is_array( $uploaded ) ) {
		$version = isset( $uploaded['installedAt'] ) ? (string) (int) $uploaded['installedAt'] : OPEN_STATION_VERSION;
		wp_enqueue_style(
			OPEN_STATION_DESKTOP_THEME_STYLE_HANDLE,
			open_station_desktop_themes_url( $slug ) . '/theme.css',
			array( 'os-variables' ),
			$version
		);
		return;
	}

	$code = open_station_desktop_theme_registry( $slug );
	if ( is_array( $code ) && ! empty( $code['cssText'] ) ) {
		// Code themes have no file to link. Register a src-less stub
		// so `wp_add_inline_style()` has a handle to hang off, and
		// keep the same dependency so print order is identical.
		wp_register_style(
			OPEN_STATION_DESKTOP_THEME_STYLE_HANDLE,
			false,
			array( 'os-variables' ),
			OPEN_STATION_VERSION
		);
		wp_enqueue_style( OPEN_STATION_DESKTOP_THEME_STYLE_HANDLE );
		wp_add_inline_style( OPEN_STATION_DESKTOP_THEME_STYLE_HANDLE, (string) $code['cssText'] );
	}
}
add_action( 'admin_enqueue_scripts', 'open_station_enqueue_desktop_theme_style', 20 );

/**
 * Add `os-desktop-theme-<slug>` to the admin body classes.
 *
 * The compiled stylesheet scopes to this class as well as to the
 * shell root, because toasts / dialogs / tooltips / context menus
 * mount on `document.body`, outside `#os-shell`.
 *
 * `admin_body_class` is a STRING filter — concatenate, never
 * array-push.
 *
 * @param string $classes Space-separated class list.
 * @return string
 */
function open_station_desktop_theme_body_class( $classes ) {
	if ( ! open_station_desktop_theme_request_is_themable() ) {
		return $classes;
	}
	$slug = open_station_active_desktop_theme_slug();
	if ( '' === $slug ) {
		return $classes;
	}
	return trim( $classes . ' os-desktop-theme-' . $slug );
}
add_filter( 'admin_body_class', 'open_station_desktop_theme_body_class', 20 );

/**
 * Inject the desktop-theme bits of the shell config.
 *
 * Uses the public `open_station_shell_config` filter rather than
 * editing the config literal in `includes/render/assets.php`, the
 * same way the stored-files module contributes `desktopStorage`.
 *
 * @param array $config Shell config.
 * @return array
 */
function open_station_desktop_theme_inject_shell_config( $config ) {
	$config['canManageDesktopThemes'] = current_user_can( open_station_desktop_theme_upload_capability() );
	$config['desktopThemesUrl']       = esc_url_raw( rest_url( 'desktop-mode/v1/desktop-themes' ) );
	return $config;
}
add_filter( 'open_station_shell_config', 'open_station_desktop_theme_inject_shell_config', 20 );
