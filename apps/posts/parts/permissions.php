<?php
/**
 * Posts app — the capability gates.
 *
 * The Posts window answers two questions, each filterable:
 *
 *   1. May the app be registered for this user? Cap-only (`edit_posts`,
 *      parity with `edit.php`) — the app's `can()` gate.
 *   2. Has the user opted into the native window? Cap AND the
 *      `nativePostsEnabled` toggle in OS Settings → Features — the
 *      combined answer for any caller that wants it; the dock-click
 *      remap reads the toggle from the JS-side settings snapshot.
 *
 * Filterable so plugins can widen the gate to a custom role, close it
 * per user (force the iframe back on), or bypass the opt-in on a
 * managed install ("everyone gets the native window").
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the Posts app registered.
 * Cap-only: the opt-in toggle is a runtime, JS-side gate (the URL →
 * app remap registry), so flipping the setting takes effect at once,
 * without an F5.
 *
 * Why split: registration runs once on `init` per page load. Gating
 * it on the opt-in too would leave a user who toggles the setting on
 * AFTER load with no app for the rest of the session, and the
 * dock-click remap would fall through to the iframe path despite the
 * setting being on. Registering eagerly costs nothing for opted-out
 * users (the remap simply doesn't fire).
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function openstation_posts_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$can = $user_id > 0 && user_can( $user_id, 'edit_posts' );

	/**
	 * Filter whether the current user is eligible to have the Posts
	 * app registered. This is the boot-time check; runtime "should the
	 * dock click use the native window?" is the JS-side
	 * `nativePostsEnabled` flag.
	 *
	 * Returning `false` skips the whole registration — no manifest, no
	 * entry in the apps registry.
	 *
	 * @param bool $can     Default: `edit_posts` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'openstation_posts_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Whether the user has opted into the native Posts experience: the
 * cap AND the toggle. The combined answer for any caller that needs
 * it (analytics, an arrange-menu entry). Registration uses
 * {@see openstation_posts_window_user_can_register()}; the dock-click
 * remap reads the JS-side settings snapshot.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function openstation_posts_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = openstation_posts_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
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
	return (bool) apply_filters( 'openstation_posts_window_user_can_use', $can, $user_id );
}
