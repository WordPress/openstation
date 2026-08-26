<?php
/**
 * OpenStation — Native User Edit Window: capability gates.
 *
 * The window is registered for ANY logged-in user (everyone has a
 * profile they can edit). Per-target capability is re-checked at
 * REST time — saving uses core's `/wp/v2/users/<id>` PUT, which
 * already enforces `edit_user, $id`; the insights endpoint here
 * applies the same check before returning data.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the User Edit window registered.
 *
 * Defaults to `true` for any logged-in user — everyone has at least
 * their own profile to edit. Returning `false` from the filter
 * disables registration entirely, which falls back to the classic
 * `user-edit.php` / `profile.php` iframe path.
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function openstation_user_edit_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0;

	/**
	 * Filter whether the current user can have the User Edit window
	 * registered.
	 *
	 * @param bool $can     Default: any logged-in user.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'openstation_user_edit_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Whether `$viewer_id` may edit `$target_id`'s profile. Server-side
 * canonical check used by the insights endpoint and any plugin code
 * that wants to mirror the gating.
 *
 * @param int $viewer_id
 * @param int $target_id
 * @return bool
 */
function openstation_user_edit_window_can_edit( $viewer_id, $target_id ) {
	$viewer_id = (int) $viewer_id;
	$target_id = (int) $target_id;
	if ( $viewer_id <= 0 || $target_id <= 0 ) {
		return false;
	}
	return (bool) user_can( $viewer_id, 'edit_user', $target_id );
}
