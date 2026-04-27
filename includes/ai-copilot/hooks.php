<?php
/**
 * Desktop Mode — AI Copilot WordPress hooks.
 *
 * Intercepts post saves, term creates/updates, and comment inserts/edits
 * then schedules async WP-Cron jobs to run the OpenAI analysis outside
 * the current HTTP request. The editor stays responsive even when the
 * OpenAI API is slow.
 *
 * Deduplication: a 60-second transient (`desktop_mode_ai_q_{type}_{id}`) prevents
 * the same entity from being queued twice when WordPress fires the hook
 * multiple times in one request (e.g. `save_post` fires for the revision
 * AND the parent on autosave-adjacent events).
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
 * @since 0.14.0
 *
 * @param string $hook      Cron hook name, e.g. 'desktop_mode_ai_analyze_post'.
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
			// (potentially slow) OpenAI call so the editor stays
			// responsive. fastcgi_finish_request() is a PHP-FPM
			// function; in other SAPIs (CLI, Apache mod_php) it is
			// not available and we proceed without it — the analysis
			// still runs, it just blocks the request exit briefly.
			if ( function_exists( 'fastcgi_finish_request' ) ) {
				fastcgi_finish_request();
			}

			// Bump execution time so a slow OpenAI response doesn't
			// hit the default 30 s limit.
			if ( ! ini_get( 'safe_mode' ) ) { // phpcs:ignore
				@set_time_limit( 120 ); // phpcs:ignore
			}

			do_action_ref_array( $hook, $args );
		},
		PHP_INT_MAX
	);
}

/**
 * Returns the user ID to attribute the API call to, trying three sources
 * in priority order:
 *
 *   1. The currently logged-in user (HTTP request context).
 *   2. A provided fallback ID (e.g. post author).
 *   3. The first administrator who has AI enabled — covers anonymous
 *      comments, WP-CLI imports, and REST API requests without an
 *      authenticated user context.
 *
 * @since 0.14.0
 *
 * @param int $fallback_user_id Author/owner to try when no current user.
 * @return int User ID, or 0 if no AI-enabled user could be found.
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

	// Last resort: any administrator with AI configured. Scans the first
	// 20 admins to avoid a full table scan on large sites.
	return desktop_mode_ai_find_enabled_user();
}

/**
 * Returns the first administrator user ID that has AI features enabled.
 *
 * Used as a last-resort fallback for anonymous comments, WP-CLI imports,
 * and other contexts where no user session is available.
 *
 * @since 0.14.0
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

// ---------------------------------------------------------------------------
// Posts & pages
// ---------------------------------------------------------------------------

/**
 * Fires after a post is saved (both create and update).
 *
 * Excluded:
 *   - Auto-saves (DOING_AUTOSAVE constant)
 *   - Revisions (post_type = 'revision')
 *   - Auto-draft / trash / inherit statuses
 *   - Unsupported post types (filtered by `desktop_mode_ai_supported_post_types`)
 *
 * We use the DOING_AUTOSAVE constant directly rather than wp_doing_autosave()
 * and check post_type directly rather than calling wp_is_post_revision() —
 * both wrapper functions may be unavailable in test/CLI bootstrap contexts
 * where the hook still fires, while the underlying constants/properties are
 * always present.
 *
 * @since 0.14.0
 *
 * @param int     $post_id Post ID.
 * @param WP_Post $post    Post object.
 * @param bool    $update  Whether this is an update.
 */
function desktop_mode_ai_on_save_post( $post_id, WP_Post $post, $update ) {
	// Skip autosaves — constant is reliable in all contexts.
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	// Skip revisions — post_type is always populated on the $post object.
	if ( 'revision' === $post->post_type ) {
		return;
	}
	if ( in_array( $post->post_status, array( 'auto-draft', 'trash', 'inherit' ), true ) ) {
		return;
	}

	$supported_types = (array) apply_filters(
		'desktop_mode_ai_supported_post_types',
		array( 'post', 'page' )
	);
	if ( ! in_array( $post->post_type, $supported_types, true ) ) {
		return;
	}

	$user_id = desktop_mode_ai_resolve_user_id( (int) $post->post_author );
	if ( ! desktop_mode_ai_is_enabled( $user_id ) ) {
		return;
	}

	desktop_mode_ai_schedule_job(
		'desktop_mode_ai_analyze_post',
		array( $post_id, $user_id ),
		'post_' . $post_id
	);
}
add_action( 'save_post', 'desktop_mode_ai_on_save_post', 20, 3 );

// ---------------------------------------------------------------------------
// Taxonomy terms — categories & tags (and any registered taxonomy)
// ---------------------------------------------------------------------------

/**
 * Shared handler for term creation and edit.
 *
 * @since 0.14.0
 *
 * @param int    $term_id  Term ID.
 * @param int    $tt_id    Term taxonomy ID (unused).
 * @param string $taxonomy Taxonomy slug.
 */
function desktop_mode_ai_on_term_change( $term_id, $tt_id, $taxonomy ) {
	$supported_taxonomies = (array) apply_filters(
		'desktop_mode_ai_supported_taxonomies',
		array( 'category', 'post_tag' )
	);
	if ( ! in_array( $taxonomy, $supported_taxonomies, true ) ) {
		return;
	}

	$user_id = desktop_mode_ai_resolve_user_id();
	if ( $user_id <= 0 ) {
		// No identifiable user for this term change — skip.
		// Term creates/edits in WP-CLI or batch imports will simply not
		// get analyzed unless a specific user context is available.
		return;
	}
	if ( ! desktop_mode_ai_is_enabled( $user_id ) ) {
		return;
	}

	desktop_mode_ai_schedule_job(
		'desktop_mode_ai_analyze_term',
		array( $term_id, $taxonomy, $user_id ),
		'term_' . $term_id . '_' . $taxonomy
	);
}

// `created_term` fires on new term insertion (all taxonomies).
add_action( 'created_term', 'desktop_mode_ai_on_term_change', 20, 3 );

// `edited_term` fires after a term has been updated.
add_action( 'edited_term', 'desktop_mode_ai_on_term_change', 20, 3 );

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

/**
 * Shared handler for new and edited comments.
 *
 * @since 0.14.0
 *
 * @param int $comment_id The comment ID.
 */
function desktop_mode_ai_on_comment_change( $comment_id ) {
	$comment = get_comment( $comment_id );
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}

	// Skip pingbacks and trackbacks — only analyze real human comments.
	if ( '' !== $comment->comment_type && 'comment' !== $comment->comment_type ) {
		return;
	}

	// Resolve the user: comment author user_id if logged-in, otherwise
	// fall back to any admin who has AI configured. We use the comment's
	// own user_id first since the commenter may have AI enabled; then
	// fall back to current_user (moderator context), then to 0 (rejected).
	$user_id = (int) $comment->user_id;
	if ( $user_id <= 0 ) {
		$user_id = desktop_mode_ai_resolve_user_id();
	}
	if ( $user_id <= 0 ) {
		return;
	}
	if ( ! desktop_mode_ai_is_enabled( $user_id ) ) {
		return;
	}

	desktop_mode_ai_schedule_job(
		'desktop_mode_ai_analyze_comment',
		array( $comment_id, $user_id ),
		'comment_' . $comment_id
	);
}

// `wp_insert_comment` fires after a new comment is inserted into the DB.
add_action( 'wp_insert_comment', 'desktop_mode_ai_on_comment_change', 20, 1 );

// `edit_comment` fires after an existing comment is updated.
add_action( 'edit_comment', 'desktop_mode_ai_on_comment_change', 20, 1 );
