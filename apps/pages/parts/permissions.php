<?php
/**
 * Pages app — the capability gates, the Posts app's twins.
 *
 * The Pages window answers two questions, each filterable:
 *
 *   1. May the app be registered for this user? Cap-only
 *      (`edit_pages`, parity with `edit.php?post_type=page`) — the
 *      app's `can()` gate.
 *   2. Has the user opted into the native window? Cap AND the
 *      `nativePagesEnabled` toggle in OS Settings → Features; flipped
 *      off, the iframe path returns without an F5.
 *
 * Filterable so plugins can widen the gate to a custom role, close it
 * per user (force the iframe back on), or bypass the opt-in on a
 * managed install.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the Pages app registered.
 * Cap-only: the opt-in toggle is a runtime, JS-side gate (the URL →
 * app remap registry), so flipping the setting takes effect at once.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function openstation_pages_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$can = $user_id > 0 && user_can( $user_id, 'edit_pages' );

	/**
	 * Filter whether the current user is eligible to have the Pages
	 * app registered. This is the boot-time check; runtime "should the
	 * dock click use the native window?" is the JS-side
	 * `nativePagesEnabled` flag.
	 *
	 * @param bool $can     Default: `edit_pages` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'openstation_pages_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Whether the user has opted into the native Pages experience: the
 * cap AND the toggle. Registration uses
 * {@see openstation_pages_window_user_can_register()}; the dock-click
 * remap reads the JS-side settings snapshot. This is the combined
 * answer for any caller that wants it.
 *
 * @param int|null $user_id Optional.
 * @return bool
 */
function openstation_pages_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = openstation_pages_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativePagesEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	/**
	 * Filter whether the current user has opted into the native Pages
	 * experience.
	 *
	 * @param bool $can     Default gate result.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters( 'openstation_pages_window_user_can_use', $can, $user_id );
}
