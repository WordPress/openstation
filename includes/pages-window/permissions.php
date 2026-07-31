<?php
/**
 * Desktop Mode — Native Pages Window: capability gate.
 *
 * The native Pages window is gated on TWO conditions, both required:
 *
 *   1. The current user can `edit_pages` (parity with `edit.php?post_type=page`).
 *   2. The user has `nativePagesEnabled` on in OS Settings → Features.
 *      The toggle is purely additive — flipped off, the iframe path is
 *      restored without F5.
 *
 * Filterable so plugins can:
 *   - widen the gate to a custom role
 *   - close it on a per-user basis (force the iframe back on)
 *   - bypass the opt-in entirely on a managed install
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the native Pages window
 * REGISTERED for them at boot. Cap-only check — the opt-in toggle is
 * a runtime, JS-side gate (handled by the URL → native-window remap
 * registry) so flipping the setting takes effect immediately.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function desktop_mode_pages_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$can = $user_id > 0 && user_can( $user_id, 'edit_pages' );

	/**
	 * Filter whether the current user is eligible to have the native
	 * Pages window registered. This is the boot-time check; runtime
	 * "should the dock click use the native window?" is the JS-side
	 * `nativePagesEnabled` flag.
	 *
	 * @param bool $can     Default: `edit_pages` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'desktop_mode_pages_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Combined cap-and-opt-in check. Boot registration uses
 * {@see desktop_mode_pages_window_user_can_register()}; the JS-side
 * remap reads the OS-settings snapshot directly. This helper is for
 * any caller that wants the combined answer.
 *
 * @param int|null $user_id Optional.
 * @return bool
 */
function desktop_mode_pages_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = desktop_mode_pages_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'desktop_mode_get_os_settings' ) ) {
		$settings = desktop_mode_get_os_settings( $user_id );
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
	return (bool) apply_filters( 'desktop_mode_pages_window_user_can_use', $can, $user_id );
}
