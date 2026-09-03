<?php
/**
 * Comments app — capability gates.
 *
 * Multi-tier gating, parallel to WordPress core's `edit-comments.php`
 * flow:
 *
 *   - `edit_posts`         → REGISTER the window. The cheapest classic-admin
 *                            cap that gates "can read the comments screen"
 *                            for any author (their own comments). The REST
 *                            controller does per-row checks.
 *   - `moderate_comments`  → approve / unapprove / spam / trash actions and
 *                            the reply composer.
 *   - `edit_comment`       → edit a comment's text (per-target, server-checked).
 *
 * UI-side gating is purely UX polish — every action and every REST
 * route in `rest.php` re-validates the cap and the per-target
 * permission before mutating anything.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the Comments window registered.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function openstation_comments_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0 && user_can( $user_id, 'edit_posts' );

	/**
	 * Filter whether the current user can have the Comments window registered.
	 *
	 * @param bool $can     Default: `edit_posts` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'openstation_comments_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Combined cap-and-opt-in check.
 *
 * @param int|null $user_id Optional.
 * @return bool
 */
function openstation_comments_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = openstation_comments_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'openstation_get_os_settings' ) ) {
		$settings = openstation_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativeCommentsEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	/**
	 * Filter whether the current user has opted into the native Comments experience.
	 *
	 * @param bool $can     Default gate result.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'openstation_comments_window_user_can_use',
		$can,
		$user_id
	);
}
