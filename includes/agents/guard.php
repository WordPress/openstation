<?php
/**
 * OpenStation — Agents: authentication guard.
 *
 * Agents own a real `wp_users` row so capability checks, edit locks,
 * comment attribution, and the standard WordPress audit trail work
 * without a parallel ACL. The row is "synthetic" only in that no
 * credential may ever resolve to it: an agent is invoked on the site's
 * behalf, it never authenticates.
 *
 * This file is the security boundary for that claim, and it is the ONE
 * part of the agents module that loads unconditionally — the rest of
 * the module sits behind the `agents` extended option, but the blocks
 * must not. Turning the feature off does not delete the agent rows, and
 * a row whose login blocks unloaded with the feature is a row that
 * accepts application passwords and password resets again.
 *
 * Two layers, because they cover different halves of WordPress:
 *
 *  - The `authenticate` chain covers everything that presents a
 *    credential: wp-login.php, XML-RPC, and application passwords.
 *  - `determine_current_user` covers everything that presents a
 *    *session*: auth cookies, and any JWT / SSO / magic-link plugin
 *    that resolves a user id without going through `authenticate`.
 *    This is the one that matters, because the `authenticate` chain
 *    never runs for cookie validation — a third-party plugin calling
 *    `wp_set_auth_cookie( $agent_id )` would otherwise hand out a live
 *    agent session with no credential involved at all.
 *
 * `determine_current_user` deliberately does NOT interfere with the
 * runner: `wp_set_current_user()` sets the global directly and never
 * re-runs the filter, so switching into an agent to evaluate ability
 * permissions still works exactly as before.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Marker meta key — the existence test for an agent.
 *
 * Lives here rather than in store.php because `openstation_agent_is_agent()`
 * must resolve even when the agents module itself is not loaded.
 */
const OPENSTATION_AGENT_USER_MARKER_META = '_desktop_mode_agent';

/**
 * Whether the given user is a OpenStation agent.
 *
 * @param int|WP_User|null $user User id or object.
 * @return bool
 */
function openstation_agent_is_agent( $user ) {
	$user_id = $user instanceof WP_User ? $user->ID : (int) $user;
	if ( $user_id <= 0 ) {
		return false;
	}
	return '1' === (string) get_user_meta( $user_id, OPENSTATION_AGENT_USER_MARKER_META, true );
}

/**
 * Block password authentication for agent users.
 *
 * Returns a `WP_Error` instead of the user object so wp-login.php
 * surfaces the message inline. Covers XML-RPC and application passwords
 * too — both authenticate through this same filter chain, at priority
 * 20, below this callback.
 *
 * Note this only fires once an earlier callback already produced a
 * `WP_User`, i.e. only when the presented credential was correct. That
 * is deliberate: a wrong password still returns the generic core error,
 * so this block never becomes a username-enumeration oracle.
 *
 * @param WP_User|WP_Error|null $user Current candidate from the chain.
 * @return WP_User|WP_Error|null
 */
function openstation_agent_block_authentication( $user ) {
	if ( $user instanceof WP_User && openstation_agent_is_agent( $user ) ) {
		return new WP_Error(
			'openstation_agent_login_blocked',
			__( 'This account is a OpenStation agent. Login is disabled.', 'desktop-mode' )
		);
	}
	return $user;
}
add_filter( 'authenticate', 'openstation_agent_block_authentication', 30 );

/**
 * Refuse to resolve an agent as the current user for a request.
 *
 * The catch-all. `authenticate` is only consulted when a credential is
 * presented; `determine_current_user` is consulted on EVERY request that
 * resolves an identity, so this covers auth cookies and every
 * third-party token/SSO scheme that hooks the same filter — including
 * ones that bypass `authenticate` entirely.
 *
 * Runs at `PHP_INT_MAX` so it is the last word regardless of what a
 * token plugin registered.
 *
 * @param int|false $user_id User id resolved so far, or false.
 * @return int|false
 */
function openstation_agent_block_session( $user_id ) {
	if ( $user_id && openstation_agent_is_agent( (int) $user_id ) ) {
		return false;
	}
	return $user_id;
}
add_filter( 'determine_current_user', 'openstation_agent_block_session', PHP_INT_MAX );

/**
 * Block password-reset emails for agent users.
 *
 * @param bool $allow   Whether to allow the reset.
 * @param int  $user_id Target user id.
 * @return bool
 */
function openstation_agent_block_password_reset( $allow, $user_id ) {
	if ( openstation_agent_is_agent( $user_id ) ) {
		return false;
	}
	return $allow;
}
add_filter( 'allow_password_reset', 'openstation_agent_block_password_reset', 10, 2 );

/**
 * Application passwords are the one credential that could authenticate
 * a never-logs-in account over REST — refuse to make them available
 * for agents, so the credential cannot be minted in the first place.
 *
 * `openstation_agent_block_authentication()` would reject it at use
 * time anyway; this stops it existing.
 *
 * @param bool    $available Whether application passwords are available.
 * @param WP_User $user      The user being checked.
 * @return bool
 */
function openstation_agent_block_application_passwords( $available, $user ) {
	if ( $user instanceof WP_User && openstation_agent_is_agent( $user ) ) {
		return false;
	}
	return $available;
}
add_filter( 'wp_is_application_passwords_available_for_user', 'openstation_agent_block_application_passwords', 10, 2 );

/**
 * Suppress the password/email-changed notification emails for agents —
 * the synthetic address is never delivered to, and a bounced
 * notification per definition edit is pure noise in the mail log.
 *
 * @param bool  $send Whether to send the notification.
 * @param array $user The original user array before changes.
 * @return bool
 */
function openstation_agent_suppress_change_emails( $send, $user ) {
	$user_id = is_array( $user ) && isset( $user['ID'] ) ? (int) $user['ID'] : 0;
	if ( $user_id > 0 && openstation_agent_is_agent( $user_id ) ) {
		return false;
	}
	return $send;
}
add_filter( 'send_password_change_email', 'openstation_agent_suppress_change_emails', 10, 2 );
add_filter( 'send_email_change_email', 'openstation_agent_suppress_change_emails', 10, 2 );

/**
 * Send front-end author archives for agents to a 404.
 *
 * `/?author=N` is the classic user-enumeration probe: it resolves a
 * numeric id to a `user_nicename`, which for an agent is the
 * `agent-<slug>` login. Login is blocked regardless, so this is not
 * exploitable on its own — but there is no reason to advertise the
 * accounts, and an agent has no meaningful public archive.
 *
 * Only the front end is touched. The plugin's own REST surface and the
 * wp-admin Users list still list agents normally.
 *
 * @param WP_Query $query The query about to run.
 * @return void
 */
function openstation_agent_block_author_archive( $query ) {
	if ( is_admin() || ! $query->is_main_query() || ! $query->is_author() ) {
		return;
	}

	$author_id = (int) $query->get( 'author' );
	if ( $author_id <= 0 ) {
		$name = $query->get( 'author_name' );
		if ( is_string( $name ) && '' !== $name ) {
			$user      = get_user_by( 'slug', $name );
			$author_id = $user ? (int) $user->ID : 0;
		}
	}

	if ( $author_id > 0 && openstation_agent_is_agent( $author_id ) ) {
		$query->set_404();
		status_header( 404 );
		nocache_headers();
	}
}
add_action( 'pre_get_posts', 'openstation_agent_block_author_archive' );
