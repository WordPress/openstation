<?php
/**
 * Desktop Mode — Native Users Window: capability gates.
 *
 * Multi-tier gating, parallel to WordPress core's `users.php` flow:
 *
 *   - `list_users`     → REGISTER the window. Cap-only check; the
 *                        opt-in toggle is JS-side.
 *   - `edit_users`     → mutation quick-actions (Send password reset,
 *                        Resend welcome).
 *   - `promote_users`  → bulk role-change action; per-target gated
 *                        through {@see desktop_mode_users_window_assignable_roles()}.
 *   - `create_users`   → "Add new user" toolbar button.
 *   - `delete_users`   → bulk-delete (single-site).
 *   - `remove_users`   → bulk-remove (multisite — removes from current site,
 *                        leaves the network user record alone).
 *
 * UI-side gating is purely UX polish — the REST routes in `rest.php`
 * re-validate every cap and every per-target permission before
 * mutating anything.
 *
 * @package WPDesktopMode
 * @since   0.8.1
 */

defined( 'ABSPATH' ) || exit;

/**
 * Whether the user is eligible to have the Users window registered.
 *
 * @since 0.8.1
 *
 * @param int|null $user_id Optional. Defaults to `get_current_user_id()`.
 * @return bool
 */
function desktop_mode_users_window_user_can_register( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;
	$can     = $user_id > 0 && user_can( $user_id, 'list_users' );

	/**
	 * Filter whether the current user can have the Users window
	 * registered. This is the boot-time check; runtime "should the
	 * dock click use the native window?" is the JS-side
	 * `nativeUsersEnabled` flag.
	 *
	 * @since 0.8.1
	 *
	 * @param bool $can     Default: `list_users` capability.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters(
		'desktop_mode_users_window_user_can_register',
		$can,
		$user_id
	);
}

/**
 * Combined cap-and-opt-in check. Used by callers that want the
 * combined answer (e.g. analytics, an arrange-menu entry).
 *
 * @since 0.8.1
 *
 * @param int|null $user_id Optional.
 * @return bool
 */
function desktop_mode_users_window_user_can_use( $user_id = null ) {
	$user_id = null === $user_id ? get_current_user_id() : (int) $user_id;

	$cap_ok = desktop_mode_users_window_user_can_register( $user_id );

	$opt_in = false;
	if ( $cap_ok && function_exists( 'desktop_mode_get_os_settings' ) ) {
		$settings = desktop_mode_get_os_settings( $user_id );
		$opt_in   = ! empty( $settings['nativeUsersEnabled'] );
	}

	$can = $cap_ok && $opt_in;

	/**
	 * Filter whether the current user has opted into the native Users
	 * experience.
	 *
	 * @since 0.8.1
	 *
	 * @param bool $can     Default gate result.
	 * @param int  $user_id User being checked.
	 */
	return (bool) apply_filters( 'desktop_mode_users_window_user_can_use', $can, $user_id );
}

/**
 * Resolve the role slugs the current viewer is allowed to assign to
 * the given target user.
 *
 * Honors core's `editable_roles` filter. Note core's default returns
 * EVERY registered role (administrator included) to any user with
 * `promote_users` — there is no built-in capability-subset hierarchy
 * in core. Sites wanting stricter rules must filter `editable_roles`
 * or `desktop_mode_users_window_assignable_roles` below. We compute
 * the list server-side and surface it on the row so the UI can hide
 * options the viewer can't apply; the REST mutation routes call this
 * same filtered helper and reject anything outside it.
 *
 * @since 0.8.1
 *
 * @param int $viewer_id Requesting user.
 * @param int $target_id Target user (optional — used by filters).
 * @return string[] Role slugs the viewer can assign to the target.
 */
function desktop_mode_users_window_assignable_roles( $viewer_id, $target_id = 0 ) {
	$viewer_id = (int) $viewer_id;
	if ( $viewer_id <= 0 || ! user_can( $viewer_id, 'promote_users' ) ) {
		return array();
	}

	// Switch to the viewer's perspective so `current_user_can` and
	// `get_editable_roles` evaluate against their caps, not whoever
	// happens to be acting at REST-init time.
	$prev_user = get_current_user_id();
	$switched  = false;
	if ( $prev_user !== $viewer_id ) {
		wp_set_current_user( $viewer_id );
		$switched = true;
	}

	// `get_editable_roles()` lives in wp-admin/includes/user.php
	// which is NOT auto-loaded by the time `init` fires (the hook
	// our window registers on). Without this require_once the
	// function doesn't exist, the array comes back empty, and the
	// admin sees only the site's default_role ("subscriber") in
	// the role dropdown — exactly the symptom that surfaced once
	// real-world testing started.
	if ( ! function_exists( 'get_editable_roles' ) ) {
		require_once ABSPATH . 'wp-admin/includes/user.php';
	}
	$editable = function_exists( 'get_editable_roles' )
		? (array) get_editable_roles()
		: array();

	if ( $switched ) {
		wp_set_current_user( $prev_user );
	}

	$slugs = array_keys( $editable );

	/**
	 * Filter the role slugs assignable by `$viewer_id` to `$target_id`.
	 *
	 * Use this to LOCK DOWN role assignment further (e.g. "site
	 * managers can't promote anyone to administrator even if core
	 * would let them"). Returning an empty array fully disables role
	 * mutation for the viewer.
	 *
	 * Returning a SUPERSET widens the REST endpoints too — both the
	 * bulk-role route and the create-user route validate the requested
	 * role against this same filtered list (see `rest.php`), so only
	 * add roles you genuinely intend to make assignable.
	 *
	 * @since 0.8.1
	 *
	 * @param string[] $slugs    Default role slug list.
	 * @param int      $viewer_id
	 * @param int      $target_id
	 */
	return (array) apply_filters(
		'desktop_mode_users_window_assignable_roles',
		$slugs,
		$viewer_id,
		$target_id
	);
}
