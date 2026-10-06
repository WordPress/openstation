<?php
/**
 * OpenStation — usage feedback: the gate, the shell config, the
 * payload, the forwarder and the REST route.
 *
 * The deactivation dialog only hears from people on their way out.
 * This one asks the people who stayed: once a user has had
 * OpenStation on for a while, the shell shows a small prompt asking
 * whether they have two minutes to say how it is going. Saying yes
 * opens a short form with three optional questions and an optional
 * email field, for anyone happy to be followed up with.
 *
 * Nothing goes out until they click Send. The answers are forwarded
 * server-side to the intake on openstation.blog, the way the
 * deactivation answer is, and nothing about the site travels with
 * them: no URL, no site id, no user name. Feedback without an email
 * is anonymous; the email field starts empty and is never prefilled,
 * so an address only leaves when its owner typed it.
 *
 * Once per user, whatever they answer. The dismissal is the
 * `usage-feedback` slug in the seen-intros registry
 * (`includes/seen-intros.php`), which the "Reset what's-new dialogs"
 * button in OpenStation Preferences → Features clears along with
 * every other intro; a submitted form is marked seen server-side in
 * the same request that forwards it, so a lost client write can
 * never re-ask someone who already answered.
 *
 * "A while" is {@see OPENSTATION_USAGE_FEEDBACK_MIN_DAYS} since the
 * user turned OpenStation on, read from the `openstation_enabled_at`
 * user meta the first-run stamps write. Time spent in the shell is
 * not tracked, so that stamp is the only signal; a user who enabled
 * before the stamp existed has no moment to count from and is never
 * asked.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Slug stored in `desktop_mode_seen_intros` once the prompt was answered or dismissed. */
const OPENSTATION_USAGE_FEEDBACK_INTRO_SLUG = 'usage-feedback';

/** Whole days a user must have had OpenStation on before the prompt appears. */
const OPENSTATION_USAGE_FEEDBACK_MIN_DAYS = 7;

/**
 * The questions the form asks, in its order, as the keys the intake
 * stores: what we can do for them, what they mainly use OpenStation
 * for, and what gets in their way or is missing.
 */
const OPENSTATION_USAGE_FEEDBACK_QUESTIONS = array( 'requests', 'use_case', 'blockers' );

/** Longest answer forwarded, in characters. */
const OPENSTATION_USAGE_FEEDBACK_ANSWER_MAX = 1000;

/**
 * Whole days since the user turned OpenStation on, or `null` when
 * the moment is unknown (they enabled before the stamp existed).
 *
 * @param int $user_id User ID.
 * @return int|null
 */
function openstation_usage_feedback_days_enabled( $user_id ) {
	$at = openstation_get_user_enabled_at( $user_id );
	if ( $at <= 0 ) {
		return null;
	}
	return max( 0, (int) floor( ( time() - $at ) / DAY_IN_SECONDS ) );
}

/**
 * Whether this user is owed the prompt right now.
 *
 * Four gates: the feature is on, the user has OpenStation on, they
 * have had it on for {@see OPENSTATION_USAGE_FEEDBACK_MIN_DAYS} whole
 * days by a real stamp, and they have not answered or dismissed it.
 *
 * @param int $user_id User ID.
 * @return bool
 */
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

/**
 * What the shell needs to show the prompt, or `null` when this user
 * is not owed it. Rides the shell config as `usageFeedback`.
 *
 * Deliberately carries no user data: the form's email field starts
 * empty.
 *
 * @param int $user_id User ID. Defaults to the current user.
 * @return array{ restUrl:string }|null
 */
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

/**
 * Sanitise the submitted answers: known questions only, plain text,
 * trimmed and capped.
 *
 * @param array $raw Question key => free text.
 * @return array<string, string> Every question key, '' when unanswered.
 */
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

/**
 * Build the payload for one submission.
 *
 * The answers, the optional email, and what a reader needs to place
 * them: versions, language, and how long the person has had
 * OpenStation on. Nothing that identifies the site. The random
 * per-submission id exists only so the intake can ignore a retry.
 * Every field is listed in `readme.txt` under "External services";
 * add one here and add it there in the same change.
 *
 * @param array<string, string> $answers Sanitised answers, from {@see openstation_usage_feedback_answers()}.
 * @param string                $email   The address the user typed, already validated, or ''.
 * @param int                   $user_id User ID, for the days-enabled count.
 * @return array
 */
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

/**
 * Forward one payload to the intake. Synchronous and short: the user
 * is waiting on the form, and a failed send is reported so they can
 * try again.
 *
 * @param array $payload The filtered payload.
 * @return bool True on a 2xx answer.
 */
function openstation_usage_feedback_forward( array $payload ) {
	/**
	 * Filters the intake URL for usage feedback. Hosts that run their
	 * own intake point this at it; it receives the JSON payload by
	 * POST. An empty string skips the forward.
	 *
	 * @param string $endpoint Default {@see OPENSTATION_USAGE_FEEDBACK_ENDPOINT}.
	 */
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

/**
 * Register `POST /desktop-mode/v1/feedback/usage`.
 */
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
				// Not `format: email`: the field is optional, and an
				// empty string has to pass. The handler validates it.
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

/**
 * Permission gate: OpenStation on for this account, plus the feature
 * flag. The prompt only ever shows inside the shell, so the strict
 * gate is the right one. No object-level check: the route stores
 * nothing on the site but the caller's own seen-intro flag.
 *
 * @return true|WP_Error
 */
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

/**
 * Handler: validate, build, filter, forward, and on success record
 * the prompt as answered so it never comes back.
 *
 * A failed forward answers `502` rather than a quiet `sent: false`:
 * the user is waiting to know whether their answers arrived. The
 * intro is NOT marked seen on failure, so they can try again or
 * close the form.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
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

	/**
	 * Filters the payload before it is forwarded. Return an empty
	 * array to suppress the send; the route then answers as if the
	 * forward failed.
	 *
	 * @param array $payload The submission.
	 */
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
