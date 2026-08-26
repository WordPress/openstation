<?php
/**
 * OpenStation — Native Users Window: last-login tracker.
 *
 * Hooks `wp_login` to record the timestamp of every successful
 * login as `_desktop_mode_last_login_at` user meta (a UTC unix
 * timestamp, stored as integer). The Users window's REST field
 * surfaces this back to the table for the Last login column.
 *
 * The meta key is intentionally underscore-prefixed (private) so
 * it doesn't show up in user-meta-management UIs but still allows
 * `update_user_meta` access.
 *
 * Plugins that want to read the value should use:
 *
 *   $ts = (int) get_user_meta( $user_id, '_desktop_mode_last_login_at', true );
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * The user meta key carrying the last successful login's UTC unix
 * timestamp. Public surface — exposed so other plugins can read /
 * sort by it.
 *
 * The VALUE keeps its pre-rebrand spelling on purpose: it is a
 * persisted or externally-visible identifier, so renaming it would
 * orphan data already written by live installs (or break a live
 * URL). The mismatch between this constant's name and its value is
 * deliberate — it is NOT a half-finished rename.
 */
const OPENSTATION_LAST_LOGIN_META_KEY = '_desktop_mode_last_login_at';

/**
 * Record the login timestamp on every `wp_login` action.
 *
 * `wp_login` fires AFTER credentials have been validated and the
 * cookie set, so any cap-eligible user reaching this point is
 * legitimately logged in. We record server time (`time()`), which
 * is always UTC by convention in PHP — match it on the read side.
 *
 * @param string  $user_login Login of the user (unused).
 * @param WP_User $user       The user object.
 */
function openstation_users_window_record_login( $user_login, $user = null ) {
	$user_id = 0;
	if ( $user instanceof WP_User ) {
		$user_id = (int) $user->ID;
	} elseif ( is_string( $user_login ) && '' !== $user_login ) {
		$by = get_user_by( 'login', $user_login );
		if ( $by instanceof WP_User ) {
			$user_id = (int) $by->ID;
		}
	}

	if ( $user_id <= 0 ) {
		return;
	}

	update_user_meta( $user_id, OPENSTATION_LAST_LOGIN_META_KEY, time() );

	/**
	 * Fires after the last-login meta has been written. Lets plugins
	 * piggy-back on the same hook to update their own last-seen
	 * tracking without duplicating the `wp_login` listener.
	 *
	 * @param int $user_id   User id whose login was recorded.
	 * @param int $timestamp Unix timestamp written.
	 */
	do_action( 'openstation_users_window_login_recorded', $user_id, time() );
}
add_action( 'wp_login', 'openstation_users_window_record_login', 10, 2 );
