<?php
/**
 * Desktop Mode — AI Copilot WP-Cron jobs.
 *
 * Registers the three async job hooks that actually call OpenAI and
 * store results. Jobs are scheduled by the WordPress hooks in
 * `hooks.php` with a short delay so they run outside the HTTP
 * request that triggered the save — keeping the editor snappy even
 * when the OpenAI API is slow.
 *
 * Hook names:
 *   wpdm_ai_analyze_post     ($post_id,    $user_id)
 *   wpdm_ai_analyze_term     ($term_id,    $taxonomy, $user_id)
 *   wpdm_ai_analyze_comment  ($comment_id, $user_id)
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

// ---------------------------------------------------------------------------
// Job: post / page
// ---------------------------------------------------------------------------

/**
 * Analyzes a post or page and stores the result in post meta.
 *
 * @since 0.14.0
 *
 * @param int $post_id The post ID.
 * @param int $user_id The ID of the user whose API key to use.
 */
function wpdm_ai_job_analyze_post( $post_id, $user_id ) {
	$post_id = (int) $post_id;
	$user_id = (int) $user_id;

	if ( ! wpdm_ai_is_enabled( $user_id ) ) {
		return;
	}

	$post = get_post( $post_id );
	if ( ! $post instanceof WP_Post ) {
		return;
	}

	/** @var array $supported_types Post types the copilot analyzes. */
	$supported_types = (array) apply_filters(
		'wp_desktop_ai_supported_post_types',
		array( 'post', 'page' )
	);
	if ( ! in_array( $post->post_type, $supported_types, true ) ) {
		return;
	}

	$api_key  = wpdm_ai_get_api_key( $user_id );
	$messages = wpdm_ai_messages_for_post( $post );
	$schema   = wpdm_ai_schema_content();

	$result = wpdm_ai_provider_structured_request( $user_id, $api_key, $messages, $schema, 'content_analysis' );

	if ( is_wp_error( $result ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[WP Desktop Mode AI] Post ' . $post_id . ' analysis failed: ' . $result->get_error_message() );
		return;
	}

	wpdm_ai_save_meta( 'post', $post_id, $result );

	/**
	 * Fires after a post or page has been successfully analyzed by the AI copilot.
	 *
	 * @since 0.14.0
	 *
	 * @param int     $post_id  The post ID.
	 * @param array   $result   The structured analysis result.
	 * @param WP_Post $post     The post object.
	 */
	do_action( 'wp_desktop_ai_post_analyzed', $post_id, $result, $post );
}
add_action( 'wpdm_ai_analyze_post', 'wpdm_ai_job_analyze_post', 10, 2 );

// ---------------------------------------------------------------------------
// Job: taxonomy term (category, tag, custom)
// ---------------------------------------------------------------------------

/**
 * Analyzes a taxonomy term and stores the result in term meta.
 *
 * @since 0.14.0
 *
 * @param int    $term_id  The term ID.
 * @param string $taxonomy The taxonomy slug.
 * @param int    $user_id  The ID of the user whose API key to use.
 */
function wpdm_ai_job_analyze_term( $term_id, $taxonomy, $user_id ) {
	$term_id = (int) $term_id;
	$user_id = (int) $user_id;

	if ( ! wpdm_ai_is_enabled( $user_id ) ) {
		return;
	}

	$term = get_term( $term_id, $taxonomy );
	if ( ! $term instanceof WP_Term ) {
		return;
	}

	$api_key  = wpdm_ai_get_api_key( $user_id );
	$messages = wpdm_ai_messages_for_term( $term );
	$schema   = wpdm_ai_schema_content();

	$result = wpdm_ai_provider_structured_request( $user_id, $api_key, $messages, $schema, 'content_analysis' );

	if ( is_wp_error( $result ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[WP Desktop Mode AI] Term ' . $term_id . ' (' . $taxonomy . ') analysis failed: ' . $result->get_error_message() );
		return;
	}

	wpdm_ai_save_meta( 'term', $term_id, $result );

	/**
	 * Fires after a taxonomy term has been successfully analyzed by the AI copilot.
	 *
	 * @since 0.14.0
	 *
	 * @param int     $term_id  The term ID.
	 * @param array   $result   The structured analysis result.
	 * @param WP_Term $term     The term object.
	 */
	do_action( 'wp_desktop_ai_term_analyzed', $term_id, $result, $term );
}
add_action( 'wpdm_ai_analyze_term', 'wpdm_ai_job_analyze_term', 10, 3 );

// ---------------------------------------------------------------------------
// Job: comment
// ---------------------------------------------------------------------------

/**
 * Analyzes a comment and stores the result in comment meta.
 *
 * @since 0.14.0
 *
 * @param int $comment_id The comment ID.
 * @param int $user_id    The ID of the user whose API key to use.
 */
function wpdm_ai_job_analyze_comment( $comment_id, $user_id ) {
	$comment_id = (int) $comment_id;
	$user_id    = (int) $user_id;

	if ( ! wpdm_ai_is_enabled( $user_id ) ) {
		return;
	}

	$comment = get_comment( $comment_id );
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}

	$api_key  = wpdm_ai_get_api_key( $user_id );
	$messages = wpdm_ai_messages_for_comment( $comment );
	$schema   = wpdm_ai_schema_comment();

	$result = wpdm_ai_provider_structured_request( $user_id, $api_key, $messages, $schema, 'comment_analysis' );

	if ( is_wp_error( $result ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[WP Desktop Mode AI] Comment ' . $comment_id . ' analysis failed: ' . $result->get_error_message() );
		return;
	}

	wpdm_ai_save_meta( 'comment', $comment_id, $result );

	/**
	 * Fires after a comment has been successfully analyzed by the AI copilot.
	 *
	 * The `$result` array always contains `topic`, `ai_summary`, `harmful`,
	 * and `spam`. Downstream plugins (e.g. a moderation helper) can act on
	 * `harmful` or `spam` here rather than polling meta.
	 *
	 * @since 0.14.0
	 *
	 * @param int        $comment_id The comment ID.
	 * @param array      $result     The structured analysis result.
	 * @param WP_Comment $comment    The comment object.
	 */
	do_action( 'wp_desktop_ai_comment_analyzed', $comment_id, $result, $comment );
}
add_action( 'wpdm_ai_analyze_comment', 'wpdm_ai_job_analyze_comment', 10, 2 );
