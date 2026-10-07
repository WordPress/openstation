<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_USAGE_FEEDBACK_INTRO_SLUG = 'usage-feedback';

const OPENSTATION_USAGE_FEEDBACK_MIN_DAYS = 7;

const OPENSTATION_USAGE_FEEDBACK_QUESTIONS = array( 'requests', 'use_case', 'blockers' );

const OPENSTATION_USAGE_FEEDBACK_ANSWER_MAX = 1000;

function openstation_usage_feedback_days_enabled( $user_id ) {
	$at = openstation_get_user_enabled_at( $user_id );
	if ( $at <= 0 ) {
		return null;
	}
	return max( 0, (int) floor( ( time() - $at ) / DAY_IN_SECONDS ) );
}

function openstation_usage_feedback_eligible( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 || ! openstation_usage_feedback_enabled() ) {
		return false;
	}
	if ( ! openstation_is_enabled( $user_id ) ) {
		return false;
	}
	$days = openstation_usage_feedback_days_enabled( $user_id );
	if ( null === $days || $days < OPENSTATION_USAGE_FEEDBACK_MIN_DAYS ) {
		return false;
	}
	return ! openstation_has_seen_intro( $user_id, OPENSTATION_USAGE_FEEDBACK_INTRO_SLUG );
}

function openstation_usage_feedback_config( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		$user_id = get_current_user_id();
	}
	if ( ! openstation_usage_feedback_eligible( $user_id ) ) {
		return null;
	}
	return array(
		'restUrl' => esc_url_raw( rest_url( 'desktop-mode/v1/feedback/usage' ) ),
	);
}

function openstation_usage_feedback_answers( array $raw ) {
	$answers = array();
	foreach ( OPENSTATION_USAGE_FEEDBACK_QUESTIONS as $key ) {
		$text = isset( $raw[ $key ] ) ? sanitize_textarea_field( (string) $raw[ $key ] ) : '';
		if ( mb_strlen( $text ) > OPENSTATION_USAGE_FEEDBACK_ANSWER_MAX ) {
			$text = mb_substr( $text, 0, OPENSTATION_USAGE_FEEDBACK_ANSWER_MAX );
		}
		$answers[ $key ] = $text;
	}
	return $answers;
}

function openstation_usage_feedback_payload( array $answers, $email, $user_id ) {
	$days = openstation_usage_feedback_days_enabled( (int) $user_id );
	return array(
		'id'             => wp_generate_uuid4(),
		'requests'       => (string) $answers['requests'],
		'use_case'       => (string) $answers['use_case'],
		'blockers'       => (string) $answers['blockers'],
		'email'          => (string) $email,
		'plugin_version' => OPENSTATION_VERSION,
		'wp_version'     => get_bloginfo( 'version' ),
		'locale'         => get_user_locale( (int) $user_id ),
		'days_enabled'   => null === $days ? 0 : $days,
	);
}

function openstation_usage_feedback_forward( array $payload ) {

	$endpoint = (string) apply_filters( 'openstation_usage_feedback_endpoint', OPENSTATION_USAGE_FEEDBACK_ENDPOINT );
	if ( '' === $endpoint ) {
		return false;
	}
	$response = wp_remote_post(
		$endpoint,
		array(
			'timeout'     => 5,
			'redirection' => 0,
			'user-agent'  => 'WP OpenStation feedback/' . OPENSTATION_VERSION,
			'headers'     => array( 'Content-Type' => 'application/json' ),
			'body'        => wp_json_encode( $payload ),
		)
	);
	return ! is_wp_error( $response ) && 2 === (int) floor( wp_remote_retrieve_response_code( $response ) / 100 );
}

function openstation_register_usage_feedback_route() {
	$text = array(
		'type'    => 'string',
		'default' => '',
	);
	register_rest_route(
		'desktop-mode/v1',
		'/feedback/usage',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_usage_feedback',
			'permission_callback' => 'openstation_rest_usage_feedback_permission',
			'args'                => array(
				'requests' => $text,
				'use_case' => $text,
				'blockers' => $text,

				'email'    => array(
					'type'      => 'string',
					'default'   => '',
					'maxLength' => 254,
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_usage_feedback_route' );

function openstation_rest_usage_feedback_permission() {
	$enabled = openstation_rest_require_enabled();
	if ( true !== $enabled ) {
		return $enabled;
	}
	if ( ! openstation_usage_feedback_enabled() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You are not allowed to do that.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

function openstation_rest_usage_feedback( WP_REST_Request $request ) {
	$answers = openstation_usage_feedback_answers(
		array(
			'requests' => $request->get_param( 'requests' ),
			'use_case' => $request->get_param( 'use_case' ),
			'blockers' => $request->get_param( 'blockers' ),
		)
	);
	if ( '' === implode( '', $answers ) ) {
		return new WP_Error(
			'openstation_empty_feedback',
			__( 'Answer at least one question first.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}

	$email = trim( (string) $request->get_param( 'email' ) );
	if ( '' !== $email ) {
		$email = sanitize_email( $email );
		if ( '' === $email || ! is_email( $email ) ) {
			return new WP_Error(
				'openstation_invalid_email',
				__( 'That does not look like an email address.', 'desktop-mode' ),
				array( 'status' => 400 )
			);
		}
	}

	$user_id = get_current_user_id();
	$payload = openstation_usage_feedback_payload( $answers, $email, $user_id );

	$payload = (array) apply_filters( 'openstation_usage_feedback_payload', $payload );

	$sent = ! empty( $payload ) && openstation_usage_feedback_forward( $payload );
	if ( ! $sent ) {
		return new WP_Error(
			'openstation_usage_feedback_not_sent',
			__( 'We could not send that right now.', 'desktop-mode' ),
			array( 'status' => 502 )
		);
	}

	openstation_mark_intro_seen( $user_id, OPENSTATION_USAGE_FEEDBACK_INTRO_SLUG );

	return rest_ensure_response( array( 'sent' => true ) );
}
