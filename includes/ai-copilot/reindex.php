<?php
/**
 * Desktop Mode — AI Copilot bulk re-index endpoint.
 *
 * Finds posts, pages, and comments that have NOT yet been analyzed
 * (i.e. they are missing the `_desktop_mode_ai_analysis` meta) and schedules
 * an analysis cron job for each one. Then calls `spawn_cron()` so
 * WordPress triggers the jobs immediately rather than waiting for the
 * next organic page-load.
 *
 * This endpoint is intentionally idempotent — calling it multiple times
 * is safe; entities that already have the meta are counted but skipped,
 * and the deduplication transient in `desktop_mode_ai_schedule_job()` prevents
 * double-queuing for entities that were just scheduled.
 *
 * Typical use cases:
 *   - Initial setup after enabling AI features.
 *   - Recovery after the hook was broken (e.g. the wp_doing_autosave bug).
 *   - Bulk re-analysis after changing the AI prompt or model.
 *
 * REST: POST /desktop-mode/v1/ai/reindex
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers the reindex REST route.
 *
 * @since 0.14.0
 */
function desktop_mode_register_ai_reindex_rest_route() {
	register_rest_route(
		'desktop-mode/v1',
		'/ai/reindex',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'desktop_mode_rest_ai_reindex',
			'permission_callback' => 'desktop_mode_rest_ai_reindex_permission',
			'args'                => array(
				'entity_types' => array(
					'required'          => false,
					'type'              => 'array',
					'default'           => array( 'post', 'page', 'comment' ),
					'items'             => array(
						'type' => 'string',
						'enum' => array( 'post', 'page', 'comment' ),
					),
					'description'       => 'Which entity types to reindex. Defaults to all three.',
				),
				'force' => array(
					'required'    => false,
					'type'        => 'boolean',
					'default'     => false,
					'description' => 'When true, re-queues ALL entities, even those already indexed.',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_register_ai_reindex_rest_route' );

/**
 * Permission: logged-in admin with AI enabled.
 *
 * Restricted to `manage_options` (admins) so arbitrary logged-in users
 * can't trigger bulk API calls that consume the site owner's OpenAI quota.
 *
 * @since 0.14.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_rest_ai_reindex_permission() {
	if ( ! is_user_logged_in() || ! current_user_can( 'manage_options' ) ) {
		return new WP_Error(
			'desktop_mode_ai_forbidden',
			'Only administrators can trigger a reindex.',
			array( 'status' => 403 )
		);
	}
	if ( ! desktop_mode_ai_is_enabled( get_current_user_id() ) ) {
		return new WP_Error(
			'desktop_mode_ai_disabled',
			'AI features are not enabled. Enable them in OS Settings → AI Settings.',
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * POST /desktop-mode/v1/ai/reindex
 *
 * Queues analysis jobs for every unindexed entity of the requested types
 * and immediately triggers WP-Cron so jobs start running.
 *
 * @since 0.14.0
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function desktop_mode_rest_ai_reindex( WP_REST_Request $request ) {
	$user_id      = get_current_user_id();
	$entity_types = (array) $request->get_param( 'entity_types' );
	$force        = (bool) $request->get_param( 'force' );

	$queued          = 0;
	$already_indexed = 0;
	$breakdown       = array();

	// -----------------------------------------------------------------------
	// Posts
	// -----------------------------------------------------------------------
	if ( in_array( 'post', $entity_types, true ) ) {
		$result = desktop_mode_ai_reindex_posts( 'post', $user_id, $force );
		$queued          += $result['queued'];
		$already_indexed += $result['already_indexed'];
		$breakdown['post'] = $result;
	}

	// -----------------------------------------------------------------------
	// Pages
	// -----------------------------------------------------------------------
	if ( in_array( 'page', $entity_types, true ) ) {
		$result = desktop_mode_ai_reindex_posts( 'page', $user_id, $force );
		$queued          += $result['queued'];
		$already_indexed += $result['already_indexed'];
		$breakdown['page'] = $result;
	}

	// -----------------------------------------------------------------------
	// Comments
	// -----------------------------------------------------------------------
	if ( in_array( 'comment', $entity_types, true ) ) {
		$result = desktop_mode_ai_reindex_comments( $user_id, $force );
		$queued          += $result['queued'];
		$already_indexed += $result['already_indexed'];
		$breakdown['comment'] = $result;
	}

	// Kick WP-Cron so jobs run without waiting for the next page-load.
	// spawn_cron() is a no-op when DISABLE_WP_CRON is true; in that case
	// the user needs to run `wp cron event run --due-now` manually.
	if ( $queued > 0 ) {
		spawn_cron();
	}

	return rest_ensure_response(
		array(
			'queued'          => $queued,
			'already_indexed' => $already_indexed,
			'breakdown'       => $breakdown,
			'note'            => $queued > 0
				? 'Jobs scheduled. If WP-Cron is disabled in your environment run: wp cron event run --due-now'
				: 'Nothing to reindex.',
		)
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Queue analysis jobs for published posts/pages without the AI meta.
 *
 * Uses `fields => 'ids'` so we only load IDs — no post content pulled
 * into memory for potentially hundreds of posts.
 *
 * @since 0.14.0
 *
 * @param string $post_type 'post' | 'page'.
 * @param int    $user_id   The user whose API key the jobs should use.
 * @param bool   $force     When true, re-queue even already-indexed posts.
 * @return array{ queued: int, already_indexed: int }
 */
function desktop_mode_ai_reindex_posts( $post_type, $user_id, $force = false ) {
	$meta_query = $force
		? array()
		: array(
			array(
				'key'     => DESKTOP_MODE_AI_META_KEY,
				'compare' => 'NOT EXISTS',
			),
		);

	$ids = get_posts(
		array(
			'post_type'      => $post_type,
			'post_status'    => 'publish',
			'posts_per_page' => -1,
			'fields'         => 'ids',
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- admin-initiated reindex: scans posts by EXISTS/NOT EXISTS on our AI-summary meta key so we know which posts still need a summary. Single-clause query against an indexed key.
			'meta_query'     => $meta_query,
		)
	);

	// When not forcing, count already-indexed separately for the report.
	$already_indexed = 0;
	if ( ! $force ) {
		$already_indexed = (int) ( new WP_Query(
			array(
				'post_type'      => $post_type,
				'post_status'    => 'publish',
				'posts_per_page' => 1,
				'fields'         => 'ids',
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- counter for the reindex report; single EXISTS clause.
				'meta_query'     => array(
					array(
						'key'     => DESKTOP_MODE_AI_META_KEY,
						'compare' => 'EXISTS',
					),
				),
			)
		) )->found_posts;
	}

	$queued = 0;
	foreach ( $ids as $post_id ) {
		// Clear the debounce transient so force-reindex always goes through.
		if ( $force ) {
			delete_transient( 'desktop_mode_ai_q_' . md5( 'post_' . $post_id ) );
		}
		desktop_mode_ai_schedule_job(
			'desktop_mode_ai_analyze_post',
			array( (int) $post_id, $user_id ),
			'post_' . $post_id
		);
		$queued++;
	}

	return array(
		'queued'          => $queued,
		'already_indexed' => $already_indexed,
	);
}

/**
 * Queue analysis jobs for approved comments without the AI meta.
 *
 * @since 0.14.0
 *
 * @param int  $user_id The user whose API key the jobs should use.
 * @param bool $force   When true, re-queue even already-indexed comments.
 * @return array{ queued: int, already_indexed: int }
 */
function desktop_mode_ai_reindex_comments( $user_id, $force = false ) {
	$meta_query = $force
		? array()
		: array(
			array(
				'key'     => DESKTOP_MODE_AI_META_KEY,
				'compare' => 'NOT EXISTS',
			),
		);

	$comments = get_comments(
		array(
			'status'     => 'approve',
			'type'       => 'comment',
			'fields'     => 'ids',
			'number'     => 0, // 0 = no limit
			// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- admin-initiated comment reindex; same EXISTS/NOT EXISTS pattern as the post reindex above.
			'meta_query' => $meta_query,
		)
	);

	$already_indexed = 0;
	if ( ! $force ) {
		$already_indexed = (int) get_comments(
			array(
				'status'     => 'approve',
				'type'       => 'comment',
				'count'      => true,
				// phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- counter for the comment-reindex report; single EXISTS clause.
				'meta_query' => array(
					array(
						'key'     => DESKTOP_MODE_AI_META_KEY,
						'compare' => 'EXISTS',
					),
				),
			)
		);
	}

	$queued = 0;
	foreach ( $comments as $comment_id ) {
		if ( $force ) {
			delete_transient( 'desktop_mode_ai_q_' . md5( 'comment_' . $comment_id ) );
		}
		desktop_mode_ai_schedule_job(
			'desktop_mode_ai_analyze_comment',
			array( (int) $comment_id, $user_id ),
			'comment_' . $comment_id
		);
		$queued++;
	}

	return array(
		'queued'          => $queued,
		'already_indexed' => $already_indexed,
	);
}
