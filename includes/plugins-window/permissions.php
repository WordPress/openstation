<?php
/**
 * Desktop Mode — Native Plugins Window: capability gates.
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
 * @package WPDesktopMode
 * @since   0.9.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the Plugins window registered.
 *
 * Cap-only check — the opt-in toggle is a runtime, JS-side gate. A
 * user who toggles the setting on AFTER load needs the window
 * already registered for the JS-side remap to find it.
 *
 * @since 0.9.0
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function desktop_mode_plugins_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0 && user_can( $user_id, 'activate_plugins' );

	/**
	 * Filter whether the current user can have the Plugins window
	 * registered. This is the boot-time check; runtime "should the
	 * dock click use the native window?" is the JS-side
	 * `nativePluginsEnabled` flag.
	 *
	 * @since 0.9.0
	 *
	 * @param bool $can     Default: `activate_plugins` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'desktop_mode_plugins_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Combined cap-and-opt-in check. Used by callers that want the
 * combined answer (e.g. analytics, an arrange-menu entry).
 *
 * @since 0.9.0
 *
 * @param int|null $user_id Optional.
 * @return bool
 */
function desktop_mode_plugins_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = desktop_mode_plugins_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'desktop_mode_get_os_settings' ) ) {
		$settings = desktop_mode_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativePluginsEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	/**
	 * Filter whether the current user has opted into the native
	 * Plugins experience.
	 *
	 * @since 0.9.0
	 *
	 * @param bool $can     Default gate result.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters( 'desktop_mode_plugins_window_user_can_use', $can, $user_id );
}

/**
 * Capability flags surfaced to the JS bundle so the UI can hide
 * actions the viewer can't perform. Server still re-validates every
 * mutation, so a tampered flag here changes nothing security-wise.
 *
 * @since 0.9.0
 *
 * @param int|null $user_id Optional.
 * @return array{install:bool,delete:bool,upload:bool,activate:bool,update:bool}
 */
function desktop_mode_plugins_window_caps( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	return array(
		'activate' => $user_id > 0 && user_can( $user_id, 'activate_plugins' ),
		'install'  => $user_id > 0 && user_can( $user_id, 'install_plugins' ),
		'delete'   => $user_id > 0 && user_can( $user_id, 'delete_plugins' ),
		'upload'   => $user_id > 0 && user_can( $user_id, 'upload_plugins' ),
		// Mirrors Core's `current_user_can( 'update_plugins' )` gate on
		// the inline "Update now" link in `wp_plugin_update_row()` — the
		// JS uses it to hide the Update action for editors / non-admin
		// roles even when `desktop_mode_update_available.available` is
		// true. Server-side, `wp_ajax_update_plugin` re-checks the cap.
		'update'   => $user_id > 0 && user_can( $user_id, 'update_plugins' ),
	);
}
