<?php
/**
 * OpenStation — Native Plugins Window: capability gates.
 *
 * Multi-tier gating, parallel to WordPress core's `plugins.php` flow:
 *
 *   - `activate_plugins` → REGISTER the window (the broad gate).
 *                          Cap-only check; the opt-in toggle is JS-side.
 *   - `install_plugins`  → Browse tab + install/upload (JS hides the
 *                          tab; AJAX routes re-validate).
 *   - `delete_plugins`   → bulk-delete + per-row delete action.
 *   - `upload_plugins`   → .zip upload (file or drag-drop).
 *
 * UI-side gating is purely UX polish — the AJAX routes in `ajax.php`
 * re-validate every cap before mutating anything.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the Plugins window registered.
 *
 * Cap-only check — the opt-in toggle is a runtime, JS-side gate. A
 * user who toggles the setting on AFTER load needs the window
 * already registered for the JS-side remap to find it.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function openstation_plugins_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0 && user_can( $user_id, 'activate_plugins' );

	/**
	 * Filter whether the current user can have the Plugins window
	 * registered. This is the boot-time check; runtime "should the
	 * dock click use the native window?" is the JS-side
	 * `nativePluginsEnabled` flag.
	 *
	 * @param bool $can     Default: `activate_plugins` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'openstation_plugins_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Combined cap-and-opt-in check. Used by callers that want the
 * combined answer (e.g. analytics, an arrange-menu entry).
 *
 * @param int|null $user_id Optional.
 * @return bool
 */
function openstation_plugins_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = openstation_plugins_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativePluginsEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	/**
	 * Filter whether the current user has opted into the native
	 * Plugins experience.
	 *
	 * @param bool $can     Default gate result.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters( 'openstation_plugins_window_user_can_use', $can, $user_id );
}

/**
 * Capability flags surfaced to the JS bundle so the UI can hide
 * actions the viewer can't perform. Server still re-validates every
 * mutation, so a tampered flag here changes nothing security-wise.
 *
 * @param int|null $user_id Optional.
 * @return array{install:bool,delete:bool,upload:bool,activate:bool,update:bool}
 */
function openstation_plugins_window_caps( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	// On multisite, plugin files are network-wide and Core's own site
	// screens deliberately offer no install, upload or delete — those
	// live in the network admin, which has no native windows. A super
	// admin HOLDS the capabilities everywhere, so a bare cap check
	// would offer actions Core hides; the screen gate has to be ours.
	// Same shape as `openstation_plugins_window_auto_updates_enabled()`.
	$site_managed = ! is_multisite();

	return array(
		'activate' => $user_id > 0 && user_can( $user_id, 'activate_plugins' ),
		'install'  => $site_managed && $user_id > 0 && user_can( $user_id, 'install_plugins' ),
		'delete'   => $site_managed && $user_id > 0 && user_can( $user_id, 'delete_plugins' ),
		'upload'   => $site_managed && $user_id > 0 && user_can( $user_id, 'upload_plugins' ),
		// Mirrors Core's `current_user_can( 'update_plugins' )` gate on
		// the inline "Update now" link in `wp_plugin_update_row()` — the
		// JS uses it to hide the Update action for editors / non-admin
		// roles even when `openstation_update_available.available` is
		// true. Server-side, `wp_ajax_update_plugin` re-checks the cap.
		'update'   => $user_id > 0 && user_can( $user_id, 'update_plugins' ),
	);
}

/**
 * Whether the Plugins window should surface an "Automatic Updates"
 * column at all.
 *
 * Mirrors Core's `WP_Plugins_List_Table::__construct()` gate:
 *
 *   $this->show_autoupdates = wp_is_auto_update_enabled_for_type( 'plugin' )
 *       && current_user_can( 'update_plugins' )
 *       && ( ! is_multisite() || $this->screen->in_admin( 'network' ) );
 *
 * `wp_is_auto_update_enabled_for_type()` lives in
 * `wp-admin/includes/update.php`. On admin requests `init` fires
 * INSIDE `wp-load.php`, BEFORE `wp-admin/admin.php` requires its
 * includes — so by the time native windows register their config on
 * `init` priority 20, the helper isn't loaded yet. We lazy-require
 * it from this gate so the config blob always reflects the true
 * state. (The check is gated by `is_admin()` so REST / front-end
 * requests don't pay the cost.)
 *
 * On multisite, only network admins can toggle plugin auto-updates —
 * Core gates the column on the network screen specifically, but we
 * use the `manage_network_plugins` capability as the user-facing
 * equivalent (true for super admins, false for everyone else).
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function openstation_plugins_window_auto_updates_enabled( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$enabled = false;
	if ( $user_id > 0 && user_can( $user_id, 'update_plugins' ) ) {
		// Lazy-require Core's admin update helper if it hasn't been
		// loaded yet. Same posture `wp_ajax_install_plugin` uses for
		// `plugins_api()` — admin-side files are safe to load when
		// we're in admin context. We guard with `is_admin()` so REST
		// / front-end requests don't pull in admin includes.
		if ( ! function_exists( 'wp_is_auto_update_enabled_for_type' ) && is_admin() ) {
			require_once ABSPATH . 'wp-admin/includes/update.php';
		}
		if (
			function_exists( 'wp_is_auto_update_enabled_for_type' )
			&& wp_is_auto_update_enabled_for_type( 'plugin' )
		) {
			if ( is_multisite() ) {
				// Network-only — match Core's `screen->in_admin( 'network' )`
				// gate as closely as we can outside a screen context.
				$enabled = user_can( $user_id, 'manage_network_plugins' );
			} else {
				$enabled = true;
			}
		}
	}

	/**
	 * Filter whether the Plugins window's "Automatic Updates" column
	 * should be shown to the current user. Return `false` to hide the
	 * column entirely (Core hides it when the auto-update subsystem is
	 * disabled or when the viewer isn't on a network admin screen on
	 * multisite).
	 *
	 * @param bool $enabled Default gate result.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters( 'openstation_plugins_window_auto_updates_enabled', $enabled, $user_id );
}
