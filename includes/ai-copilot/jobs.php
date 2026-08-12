<?php
/**
 * OpenStation — AI Copilot WP-Cron jobs.
 *
 * Registers the async comment-analysis hook that scores a comment for
 * spam/harmful content and stores the verdict in comment meta. The job is
 * scheduled by the Comments-window moderation feature (which is opt-in and
 * off by default) with a short delay so it runs outside the HTTP request that
 * triggered the comment.
 *
 * Generation routes through the WordPress AI Client (`wp_ai_client_prompt()`),
 * which sources credentials from Settings → Connectors — the copilot never
 * handles an API key.
 *
 * Hook name:
 *   desktop_mode_ai_analyze_comment  ($comment_id, $user_id)
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

// ---------------------------------------------------------------------------
// Job: comment
// ---------------------------------------------------------------------------

/**
 * Analyzes a comment and stores the result in comment meta.
 *
 * @param int $comment_id The comment ID.
 * @param int $user_id    The user to attribute the request to.
 */
function openstation_ai_job_analyze_comment( $comment_id, $user_id ) {
	$comment_id = (int) $comment_id;
	$user_id    = (int) $user_id;

	// No usable text-generation provider is configured in Connectors — nothing
	// to do. The scheduler already checks this, but the job runs async so we
	// re-check to avoid emitting failed requests if the provider was removed.
	if ( ! openstation_ai_provider_configured() ) {
		return;
	}

	$comment = get_comment( $comment_id );
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}

	$result = openstation_ai_analyze_comment_now( $comment, $user_id );

	if ( is_wp_error( $result ) ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( '[WP OpenStation AI] Comment ' . $comment_id . ' analysis failed: ' . $result->get_error_message() );
		return;
	}

	openstation_ai_save_meta( 'comment', $comment_id, $result );

	/**
	 * Fires after a comment has been successfully analyzed by the AI copilot.
	 *
	 * The `$result` array always contains `topic`, `ai_summary`, `harmful`,
	 * and `spam`. Downstream plugins (e.g. a moderation helper) can act on
	 * `harmful` or `spam` here rather than polling meta.
	 *
	 * @param int        $comment_id The comment ID.
	 * @param array      $result     The structured analysis result.
	 * @param WP_Comment $comment    The comment object.
	 */
	do_action( 'openstation_ai_comment_analyzed', $comment_id, $result, $comment );
}
add_action( 'desktop_mode_ai_analyze_comment', 'openstation_ai_job_analyze_comment', 10, 2 );

/**
 * Runs the structured comment analysis through the AI Client.
 *
 * Converts the chat-style prompt from {@see openstation_ai_messages_for_comment()}
 * into a system instruction + user prompt, requests JSON constrained to the
 * comment schema, and decodes the result.
 *
 * @param WP_Comment $comment The comment to analyze.
 * @param int        $user_id Requesting user id.
 * @return array|WP_Error Structured `{ topic, ai_summary, harmful, spam }` or an error.
 */
function openstation_ai_analyze_comment_now( WP_Comment $comment, $user_id ) {
	$messages = openstation_ai_messages_for_comment( $comment );
	$schema   = openstation_ai_schema_comment();

	$system = '';
	$prompt = '';
	foreach ( $messages as $message ) {
		$role = isset( $message['role'] ) ? $message['role'] : '';
		if ( 'system' === $role ) {
			$system = (string) $message['content'];
		} elseif ( 'user' === $role ) {
			$prompt = (string) $message['content'];
		}
	}

	$builder = wp_ai_client_prompt( $prompt );
	if ( '' !== $system ) {
		$builder = $builder->using_system_instruction( $system );
	}
	// Provider + model are chosen by the Core AI Client unless the
	// model-config filter says otherwise.

	$builder = $builder->as_json_response( openstation_ai_normalize_response_schema( $schema ) );
	$builder = openstation_ai_apply_model_config(
		$builder,
		array(
			'user_id'    => (int) $user_id,
			'source'     => 'ai-copilot/comment-analysis',
			'has_schema' => true,
		)
	);

	$json = $builder->generate_text();
	if ( is_wp_error( $json ) ) {
		return $json;
	}

	$result = json_decode( (string) $json, true );
	if ( ! is_array( $result ) ) {
		return new WP_Error( 'openstation_ai_bad_json', 'The AI response was not valid JSON.' );
	}

	return $result;
}
