<?php

defined( 'ABSPATH' ) || exit;

function openstation_ai_job_analyze_comment( $comment_id, $user_id ) {
	$comment_id = (int) $comment_id;
	$user_id    = (int) $user_id;

	if ( ! openstation_ai_provider_configured() ) {
		return;
	}

	$comment = get_comment( $comment_id );
	if ( ! $comment instanceof WP_Comment ) {
		return;
	}

	$result = openstation_ai_analyze_comment_now( $comment, $user_id );

	if ( is_wp_error( $result ) ) {

		error_log( '[WP OpenStation AI] Comment ' . $comment_id . ' analysis failed: ' . $result->get_error_message() );
		return;
	}

	openstation_ai_save_meta( 'comment', $comment_id, $result );

	do_action( 'openstation_ai_comment_analyzed', $comment_id, $result, $comment );
}
add_action( 'desktop_mode_ai_analyze_comment', 'openstation_ai_job_analyze_comment', 10, 2 );

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
