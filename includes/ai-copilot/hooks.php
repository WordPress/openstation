<?php
/**
 * Desktop Mode — AI Copilot job-scheduling helpers.
 *
 * Provides the async-job scheduler and user-resolution helpers used by the
 * Comments-window moderation feature (see
 * `includes/comments-window/ai-moderation.php`) to queue comment analysis
 * outside the HTTP request that triggered the comment. Moderation stays
 * responsive even when the provider is slow.
 *
 * Comment analysis is the only auto-analysis the copilot performs — it feeds
 * the comments-window spam score, and only when the (opt-in, off-by-default)
 * Comments AI toggle is on. Posts, pages, and taxonomy terms are NOT analyzed;
 * the AI assistant finds them with native WordPress keyword search instead
 * (see search.php).
 *
 * Deduplication: a 120-second transient (`desktop_mode_ai_q_<md5 of
 * '{type}_{id}'>`) prevents the same comment from being queued twice when
 * WordPress fires the hook multiple times in one request.
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Schedules an AI analysis job and ensures it runs even in environments
 * where WP-Cron's HTTP-based spawn_cron() cannot reach the site
 * (e.g. Docker dev setups where localhost:PORT doesn't resolve from
 * inside the container).
 *
 * Two-track approach:
 *   1. WP-Cron: reliable in production with a system cron or a host
 *      that can make loopback HTTP requests.
 *   2. Shutdown handler: runs the job in the same PHP process, after
 *      the HTTP response has been sent to the browser via
 *      fastcgi_finish_request() (available in PHP-FPM, which Docker
 *      environments use). Falls back to running after the request in
 *      non-FPM setups (e.g. WP-CLI).
 *
 * The deduplication transient prevents the same entity from being
 * queued and run twice within the guard window.
 *
 * @param string $hook      Cron hook name, e.g. 'desktop_mode_ai_analyze_comment'.
 * @param array  $args      Arguments passed to the hook callback.
 * @param string $dedup_key Unique string used to build the transient key.
 */
function desktop_mode_ai_schedule_job( $hook, array $args, $dedup_key ) {
	$transient = 'desktop_mode_ai_q_' . md5( $dedup_key );

	if ( get_transient( $transient ) ) {
		return; // Already queued within the guard window — skip.
	}

	// Schedule via WP-Cron for production environments.
	wp_schedule_single_event( time(), $hook, $args );

	// Mark as queued before the shutdown handler fires so re-entrant
	// saves (e.g. a meta update during analysis) don't double-queue.
	set_transient( $transient, 1, 120 );

	// Run on shutdown — covers Docker dev environments and WP-CLI where
	// WP-Cron's loopback HTTP request cannot reach the site.
	// PHP_INT_MAX priority ensures we run last, after WordPress has
	// finished any pending DB writes from the current request.
	add_action(
		'shutdown',
		static function () use ( $hook, $args ) {
			// Send the HTTP response to the browser before the
			// (potentially slow) provider call so the editor stays
			// responsive. fastcgi_finish_request() is a PHP-FPM
			// function; in other SAPIs (CLI, Apache mod_php) it is
			// not available and we proceed without it — the analysis
			// still runs, it just blocks the request exit briefly.
			if ( function_exists( 'fastcgi_finish_request' ) ) {
				fastcgi_finish_request();
			}

			// phpcs:ignore WordPress.NamingConventions.PrefixAllGlobals.DynamicHooknameFound -- generic dispatcher; caller passes a desktop_mode_* hook name.
			do_action_ref_array( $hook, $args );
		},
		PHP_INT_MAX
	);
}

/**
 * Returns the user ID to attribute the request to, trying three sources
 * in priority order:
 *
 *   1. The currently logged-in user (HTTP request context).
 *   2. A provided fallback ID (e.g. post author).
 *   3. The first administrator who has the AI assistant enabled — covers
 *      anonymous comments, WP-CLI imports, and REST API requests without an
 *      authenticated user context.
 *
 * @param int $fallback_user_id Author/owner to try when no current user.
 * @return int User ID, or 0 if none could be found.
 */
function desktop_mode_ai_resolve_user_id( $fallback_user_id = 0 ) {
	$uid = get_current_user_id();
	if ( $uid > 0 ) {
		return $uid;
	}

	$fallback = (int) $fallback_user_id;
	if ( $fallback > 0 ) {
		return $fallback;
	}

	// Last resort: any administrator with the assistant enabled. Scans the
	// first 20 admins to avoid a full table scan on large sites.
	return desktop_mode_ai_find_enabled_user();
}

/**
 * Returns the first administrator user ID that has the AI assistant enabled.
 *
 * Used as a last-resort fallback for anonymous comments, WP-CLI imports,
 * and other contexts where no user session is available.
 *
 * @return int User ID, or 0 if none found.
 */
function desktop_mode_ai_find_enabled_user() {
	$admin_ids = get_users(
		array(
			'role'   => 'administrator',
			'number' => 20,
			'fields' => 'ID',
		)
	);

	foreach ( $admin_ids as $uid ) {
		if ( desktop_mode_ai_is_enabled( (int) $uid ) ) {
			return (int) $uid;
		}
	}

	return 0;
}
