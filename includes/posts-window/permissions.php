<?php
/**
 * Desktop Mode — Native Posts Window: capability gate.
 *
 * The native Posts window is gated on TWO conditions, both required:
 *
 *   1. The current user can `edit_posts` (parity with `edit.php`).
 *   2. The user has flipped `nativePostsEnabled` on in OS Settings →
 *      Features. This keeps the iframe path the default — the toggle
 *      is purely additive.
 *
 * Filterable so plugins can:
 *   - widen the gate to a custom role (return true for, say, contributor)
 *   - close it on a per-user basis (force the iframe back on)
 *   - bypass the opt-in entirely on a managed install ("everyone gets the
 *     native window")
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the native Posts window
 * REGISTERED for them at boot. Cap-only check — the opt-in toggle is
 * a runtime, JS-side gate (handled by the URL → native-window remap
 * registry) so that flipping the setting takes effect immediately,
 * without forcing an F5.
 *
 * Why split: the registration runs once on `init` per page load. If
 * we gated registration on the opt-in too, a user who toggled the
 * setting on AFTER load would have the window unregistered for the
 * remainder of the session, and the dock-click remap would fall
 * through to the iframe path despite the setting being on.
 * Registering eagerly costs nothing for opted-out users (the dock
 * remap simply doesn't fire) and unblocks instant feedback.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function desktop_mode_posts_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$can = $user_id > 0 && user_can( $user_id, 'edit_posts' );

	/**
	 * Filter whether the current user is eligible to have the native
	 * Posts window registered. This is the boot-time check; runtime
	 * "should the dock click use the native window?" is the JS-side
	 * `nativePostsEnabled` flag.
	 *
	 * Returning `false` skips the entire registration — no script
	 * handle, no template, no entry in the native-window registry.
	 *
	 * @param bool $can     Default: `edit_posts` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'desktop_mode_posts_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Whether the user has opted into the native Posts experience.
 * Cap-and-opt-in check — kept for any caller that needs the combined
 * answer (e.g. analytics, an arrange-menu entry). Boot registration
 * uses {@see desktop_mode_posts_window_user_can_register()} instead;
 * runtime dock-click swap uses the JS-side snapshot.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function desktop_mode_posts_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = desktop_mode_posts_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'desktop_mode_get_os_settings' ) ) {
		$settings = desktop_mode_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativePostsEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	/**
	 * Filter whether the current user has opted into the native Posts
	 * experience.
	 *
	 * Default: `edit_posts` AND the user has flipped the toggle in OS
	 * Settings → Features. Returning `false` does NOT prevent
	 * registration (toggle on/off remains live without F5); it only
	 * affects callers that ask the combined question.
	 *
	 * @param bool $can     Default gate result.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters( 'desktop_mode_posts_window_user_can_use', $can, $user_id );
}
