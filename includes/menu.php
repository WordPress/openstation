<?php
/**
 * Desktop Mode — Live menu REST endpoint.
 *
 * Exposes the current admin menu split into `dockItems` + `taskbarItems`
 * so the shell can reload it after the admin menu changes under its
 * feet — the paradigmatic case being plugin activation / deactivation.
 *
 * The shell boots with a snapshot of the menu localized into
 * `wpDesktopConfig.dockItems` + `wpDesktopConfig.taskbarItems`. That
 * snapshot is correct for the page load but goes stale the moment the
 * user activates a new plugin inside a windowed `plugins.php` — the
 * iframe reloads, the parent shell does not. Without a refresh path
 * the new plugin's top-level menu never appears on the taskbar until
 * the user hard-reloads the whole tab.
 *
 * This endpoint is the refresh path: the chromeless bridge in
 * `render.php` postMessages `wp-desktop-plugins-changed` when the
 * activation redirect lands, and the shell fetches here to get the
 * fresh split. Shared underlying builder (`desktop_mode_build_menu_payload`)
 * guarantees the live payload matches the boot payload.
 *
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register `GET /wp-desktop/v1/menu`.
 *
 * @since 0.9.0
 */
function desktop_mode_register_menu_route() {
	register_rest_route(
		'wp-desktop/v1',
		'/menu',
		array(
			'methods'             => 'GET',
			'callback'            => 'desktop_mode_rest_get_menu',
			'permission_callback' => function () {
				// `read` is the floor for any wp-admin access, which is
				// what the shell represents. Anything stricter would
				// block legitimate subscribers; anything looser would
				// leak the menu to unauthenticated requests.
				return is_user_logged_in() && current_user_can( 'read' );
			},
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_menu_route' );

/**
 * REST callback: returns the current menu split.
 *
 * Bootstraps the admin menu first — REST requests don't load
 * `wp-admin/menu.php`, so the `$menu` / `$submenu` globals are empty
 * by default and `desktop_mode_build_menu_payload()` would return an empty
 * split. Without the bootstrap, the shell's live-refresh path (fired
 * after the user activates a plugin inside a windowed `plugins.php`)
 * would call `replaceItems([])` on both the dock + taskbar and wipe
 * every icon from the sidebar. We saw exactly that regression in the
 * wild before this fix landed.
 *
 * Always goes through `desktop_mode_build_menu_payload()` so every piece of
 * routing logic (core heuristic, per-item filter, capability checks,
 * badge counts) is applied exactly once, in the same order as the
 * shell's initial render.
 *
 * @since 0.9.0
 *
 * @return WP_REST_Response Payload with `dockItems` + `taskbarItems`.
 */
function desktop_mode_rest_get_menu() {
	desktop_mode_bootstrap_admin_menu_for_rest();
	return rest_ensure_response( desktop_mode_build_menu_payload() );
}

/**
 * Fire the admin-menu bootstrap WordPress normally runs at the top of
 * `wp-admin/admin.php`. Skipped entirely when the menu is already
 * built (i.e. we're somehow entering this path from an admin
 * request).
 *
 * Side effects, in order:
 *
 *   1. Defines `WP_ADMIN` + `WP_NETWORK_ADMIN` + `WP_USER_ADMIN`
 *      if missing. Plugin hooks that gate on `is_admin()` then
 *      pass, which is what lets them register their top-level
 *      menus via `add_menu_page()`.
 *   2. Loads `wp-admin/includes/admin.php` for helper functions
 *      like `add_menu_page`. Plugins that lazy-load their menu
 *      registration files reach these symbols here.
 *   3. Requires `wp-admin/menu.php`, which fires the
 *      `admin_menu` action. That's where plugins populate
 *      `$menu` / `$submenu` via `add_menu_page()` /
 *      `add_submenu_page()`.
 *
 * The `admin_init` hook is intentionally NOT fired — plugins use
 * that for admin redirects / option writes / settings registration,
 * firing it during a REST read would trigger real side effects that
 * have nothing to do with menu data. `admin_menu` itself runs
 * BEFORE `admin_init` in the normal admin lifecycle, so plugin
 * menu-registration callbacks don't depend on `admin_init` state.
 *
 * @since 0.9.0
 */
function desktop_mode_bootstrap_admin_menu_for_rest() {
	if ( ! empty( $GLOBALS['menu'] ) ) {
		return;
	}

	if ( ! defined( 'WP_ADMIN' ) ) {
		define( 'WP_ADMIN', true );
	}
	if ( ! defined( 'WP_NETWORK_ADMIN' ) ) {
		define( 'WP_NETWORK_ADMIN', false );
	}
	if ( ! defined( 'WP_USER_ADMIN' ) ) {
		define( 'WP_USER_ADMIN', false );
	}

	// `add_menu_page` + friends live in admin/includes; a plugin's
	// first menu registration call would explode without them.
	if ( ! function_exists( 'add_menu_page' ) ) {
		require_once ABSPATH . 'wp-admin/includes/admin.php';
	}

	// Builds `$menu` / `$submenu` and fires `admin_menu`. Guarded by
	// `require_once` so a persistent PHP process that handles
	// multiple REST hits in one lifetime doesn't re-fire
	// `admin_menu` and double-register plugin menus. The
	// `$GLOBALS['menu']` emptiness check above is the first-line
	// guard; this is belt-and-suspenders for PHP-FPM setups with
	// OpCache where the include cache straddles requests.
	require_once ABSPATH . 'wp-admin/menu.php';
}
