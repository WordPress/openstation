<?php
/**
 * Desktop Mode — AI Copilot WP-Cron jobs.
 *
 * Registers the async comment-analysis hook that calls OpenAI and stores
 * the spam/harmful verdict. The job is scheduled by the comment hook in
 * `hooks.php` with a short delay so it runs outside the HTTP request that
 * triggered the comment — keeping moderation snappy even when the OpenAI
 * API is slow.
 *
 * Comment analysis is the only auto-analysis the copilot performs; posts,
 * pages, and terms are no longer analyzed.
 *
 * Hook name:
 *   desktop_mode_ai_analyze_comment  ($comment_id, $user_id)
 *
 * @package WPDesktopMode
 */

defined( 'ABSPATH' ) || exit;

// ---------------------------------------------------------------------------
// Job: comment
// ---------------------------------------------------------------------------

/**
 * Analyzes a comment and stores the result in comment meta.
 *
 * @since 0.5.0
 *
 * @param int $comment_id The comment ID.
 * @param int $user_id    The ID of the user whose API key to use.
 */
function desktop_mode_ai_job_analyze_comment( $comment_id, $user_id ) {
	$comment_id = (int) $comment_id;
	$user_id    = (int) $user_id;

	if ( ! desktop_mode_ai_is_enabled( $user_id ) ) {
		return;
	}

	$comment = get_comment( $comment_id );
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}

	$api_key  = desktop_mode_ai_get_api_key( $user_id );
	$messages = desktop_mode_ai_messages_for_comment( $comment );
	$schema   = desktop_mode_ai_schema_comment();

	$result = desktop_mode_ai_provider_structured_request( $user_id, $api_key, $messages, $schema, 'comment_analysis' );

	if ( is_wp_error( $result ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[WP Desktop Mode AI] Comment ' . $comment_id . ' analysis failed: ' . $result->get_error_message() );
		return;
	}

	desktop_mode_ai_save_meta( 'comment', $comment_id, $result );

	/**
	 * Fires after a comment has been successfully analyzed by the AI copilot.
	 *
	 * The `$result` array always contains `topic`, `ai_summary`, `harmful`,
	 * and `spam`. Downstream plugins (e.g. a moderation helper) can act on
	 * `harmful` or `spam` here rather than polling meta.
	 *
	 * @since 0.5.0
	 *
	 * @param int        $comment_id The comment ID.
	 * @param array      $result     The structured analysis result.
	 * @param WP_Comment $comment    The comment object.
	 */
	do_action( 'desktop_mode_ai_comment_analyzed', $comment_id, $result, $comment );
}
add_action( 'desktop_mode_ai_analyze_comment', 'desktop_mode_ai_job_analyze_comment', 10, 2 );
