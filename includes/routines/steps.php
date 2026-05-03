<?php
/**
 * Desktop Mode — Routines: built-in step handlers.
 *
 * Each handler receives `( array $args, array $context )` and returns
 * either an associative array (merged into the run's variable scope
 * for downstream interpolation) or a `WP_Error`.
 *
 * `$context` keys:
 *   - `routine_id` (int)
 *   - `run_as_user_id` (int) — author or system admin id
 *   - `payload` (array)       — bound trigger payload
 *   - `vars`    (array)       — accumulator visible to {{var.…}} refs
 *   - `step_path` (string)    — diagnostic path for logs
 *
 * @package WPDesktopMode
 * @since   0.22.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Resolve `{{path.to.value}}` placeholders against payload + vars.
 *
 * Pure string-in, anything-out — single placeholder strings ("{{foo}}")
 * return the underlying value as-is (so an int stays an int), while
 * mixed strings ("hello {{name}}") get stringified by interpolation.
 *
 * @since 0.22.0
 *
 * @param mixed $value   Raw step arg (any JSON-serialisable type).
 * @param array $context Run context.
 * @return mixed Resolved value.
 */
function wpdm_routine_resolve( $value, $context ) {
	if ( is_array( $value ) ) {
		$out = array();
		foreach ( $value as $k => $v ) {
			$out[ $k ] = wpdm_routine_resolve( $v, $context );
		}
		return $out;
	}
	if ( ! is_string( $value ) ) {
		return $value;
	}
	// Single-placeholder fast path — preserves the underlying type.
	if ( preg_match( '/^\{\{\s*([a-zA-Z0-9_.\[\]\-]+)\s*\}\}$/', $value, $m ) ) {
		return wpdm_routine_lookup_path( $m[1], $context );
	}
	return preg_replace_callback(
		'/\{\{\s*([a-zA-Z0-9_.\[\]\-]+)\s*\}\}/',
		static function ( $m ) use ( $context ) {
			$resolved = wpdm_routine_lookup_path( $m[1], $context );
			if ( is_scalar( $resolved ) ) {
				return (string) $resolved;
			}
			$encoded = wp_json_encode( $resolved );
			return is_string( $encoded ) ? $encoded : '';
		},
		$value
	);
}

/**
 * Walk a dotted path through payload + vars.
 *
 * @since 0.22.0
 *
 * @param string $path    Dotted path like `payload.post.ID` or
 *                        `vars.previous_step.result`.
 * @param array  $context Run context.
 * @return mixed Resolved value or empty string on miss.
 */
function wpdm_routine_lookup_path( $path, $context ) {
	$root  = array(
		'payload' => $context['payload'] ?? array(),
		'vars'    => $context['vars'] ?? array(),
		'user'    => array(
			'id' => (int) ( $context['run_as_user_id'] ?? 0 ),
		),
		'site'    => array(
			'url'  => home_url(),
			'name' => get_bloginfo( 'name' ),
		),
	);
	$parts = explode( '.', $path );
	$cur   = $root;
	foreach ( $parts as $part ) {
		if ( is_array( $cur ) && array_key_exists( $part, $cur ) ) {
			$cur = $cur[ $part ];
		} elseif ( is_object( $cur ) && isset( $cur->$part ) ) {
			$cur = $cur->$part;
		} else {
			return '';
		}
	}
	return $cur;
}

/**
 * Compare two values under one of the known operators.
 *
 * @since 0.22.0
 *
 * @param mixed  $left  Left operand.
 * @param string $op    Operator slug.
 * @param mixed  $right Right operand.
 * @return bool
 */
function wpdm_routine_compare( $left, $op, $right ) {
	switch ( $op ) {
		case 'eq':
			return $left == $right; // phpcs:ignore WordPress.PHP.StrictComparisons
		case 'neq':
			return $left != $right; // phpcs:ignore WordPress.PHP.StrictComparisons
		case 'gt':
			return is_numeric( $left ) && is_numeric( $right ) && $left > $right;
		case 'gte':
			return is_numeric( $left ) && is_numeric( $right ) && $left >= $right;
		case 'lt':
			return is_numeric( $left ) && is_numeric( $right ) && $left < $right;
		case 'lte':
			return is_numeric( $left ) && is_numeric( $right ) && $left <= $right;
		case 'contains':
			if ( is_array( $left ) ) {
				return in_array( $right, $left, false ); // phpcs:ignore WordPress.PHP.StrictInArray
			}
			return is_string( $left ) && is_scalar( $right ) && false !== stripos( $left, (string) $right );
		case 'starts_with':
			return is_string( $left ) && is_scalar( $right ) && 0 === stripos( $left, (string) $right );
		case 'ends_with':
			return is_string( $left ) && is_scalar( $right ) && substr( strtolower( $left ), -strlen( (string) $right ) ) === strtolower( (string) $right );
		case 'matches':
			return is_string( $left ) && is_string( $right ) && @preg_match( $right, $left ) > 0; // phpcs:ignore WordPress.PHP.NoSilencedErrors
		case 'in':
			return is_array( $right ) && in_array( $left, $right, false ); // phpcs:ignore WordPress.PHP.StrictInArray
		case 'not_in':
			return is_array( $right ) && ! in_array( $left, $right, false ); // phpcs:ignore WordPress.PHP.StrictInArray
		case 'truthy':
			return (bool) $left;
		case 'falsy':
			return ! $left;
	}
	return false;
}

/**
 * Email step handler.
 *
 * Args: `to`, `subject`, `body`, `headers` (optional).
 *
 * @since 0.22.0
 *
 * @param array $args    Step args (already placeholder-resolved).
 * @param array $context Run context.
 * @return array|WP_Error
 */
function wpdm_routine_step_email( $args, $context ) {
	$to      = isset( $args['to'] ) ? (string) $args['to'] : '';
	$subject = isset( $args['subject'] ) ? (string) $args['subject'] : '';
	$body    = isset( $args['body'] ) ? (string) $args['body'] : '';
	$headers = isset( $args['headers'] ) && is_array( $args['headers'] ) ? $args['headers'] : array();

	if ( '' === $to ) {
		$to = (string) get_option( 'admin_email' );
	}
	if ( '' === $to || ! is_email( $to ) ) {
		return new WP_Error( 'wpdm_routine_step_email_invalid_to', 'Invalid recipient.', array( 'to' => $to ) );
	}
	$ok = wp_mail( $to, $subject, $body, $headers );
	if ( ! $ok ) {
		return new WP_Error( 'wpdm_routine_step_email_failed', 'wp_mail() returned false.' );
	}
	return array( 'sent_to' => $to );
}

/**
 * HTTP request step.
 *
 * Args: `url`, `method` (GET/POST/PUT/PATCH/DELETE), `headers`, `body`.
 *
 * Outbound host is gated by the `wp_desktop_routine_http_allowlist`
 * filter — default empty. A site owner that wants to allow Slack
 * webhooks adds `hooks.slack.com` to the allowlist, and only then
 * will the step succeed.
 *
 * @since 0.22.0
 *
 * @param array $args    Step args.
 * @param array $context Run context.
 * @return array|WP_Error
 */
function wpdm_routine_step_http( $args, $context ) {
	$url = isset( $args['url'] ) ? (string) $args['url'] : '';
	if ( '' === $url || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
		return new WP_Error( 'wpdm_routine_step_http_invalid_url', 'Invalid URL.' );
	}
	$parsed = wp_parse_url( $url );
	$scheme = isset( $parsed['scheme'] ) ? strtolower( (string) $parsed['scheme'] ) : '';
	$host   = isset( $parsed['host'] ) ? strtolower( (string) $parsed['host'] ) : '';
	if ( ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
		return new WP_Error( 'wpdm_routine_step_http_bad_scheme', 'Only http/https URLs allowed.' );
	}

	/**
	 * Outbound HTTP host allowlist for the `http` step.
	 *
	 * Default is empty — every host must be opted in. Returning `[ '*' ]`
	 * disables the check (don't unless you trust every routine author).
	 *
	 * @since 0.22.0
	 *
	 * @param string[] $hosts Allowed hosts.
	 */
	$allowlist = (array) apply_filters( 'wp_desktop_routine_http_allowlist', array() );
	$wide_open = in_array( '*', $allowlist, true );
	if ( ! $wide_open ) {
		$ok = false;
		foreach ( $allowlist as $allowed ) {
			$allowed = strtolower( (string) $allowed );
			if ( $allowed === $host || ( '.' === $allowed[0] && substr( $host, -strlen( $allowed ) ) === $allowed ) ) {
				$ok = true;
				break;
			}
		}
		if ( ! $ok ) {
			return new WP_Error(
				'wpdm_routine_step_http_host_blocked',
				sprintf( 'Host `%s` is not in the allowlist. Add it via the wp_desktop_routine_http_allowlist filter.', $host )
			);
		}
	}

	$method = strtoupper( (string) ( $args['method'] ?? 'GET' ) );
	if ( ! in_array( $method, array( 'GET', 'POST', 'PUT', 'PATCH', 'DELETE' ), true ) ) {
		$method = 'GET';
	}

	$body = $args['body'] ?? null;
	if ( is_array( $body ) ) {
		$body = wp_json_encode( $body );
		if ( ! isset( $args['headers']['Content-Type'] ) && ! isset( $args['headers']['content-type'] ) ) {
			$args['headers']['Content-Type'] = 'application/json';
		}
	}

	$response = wp_remote_request(
		$url,
		array(
			'method'  => $method,
			'headers' => isset( $args['headers'] ) && is_array( $args['headers'] ) ? $args['headers'] : array(),
			'body'    => $body,
			'timeout' => 10,
		)
	);
	if ( is_wp_error( $response ) ) {
		return $response;
	}
	$code = wp_remote_retrieve_response_code( $response );
	$resp = wp_remote_retrieve_body( $response );
	$json = json_decode( (string) $resp, true );
	return array(
		'status' => (int) $code,
		'body'   => null === $json ? (string) $resp : $json,
	);
}

/**
 * Log step.
 *
 * Args: `level` (info|warning|error), `message`. Writes to PHP error
 * log AND records the entry into the run's `steps_log`. Useful for
 * debugging routines and as a "did this fire?" sentinel.
 *
 * @since 0.22.0
 *
 * @param array $args    Step args.
 * @param array $context Run context.
 * @return array
 */
function wpdm_routine_step_log( $args, $context ) {
	$level   = (string) ( $args['level'] ?? 'info' );
	$message = (string) ( $args['message'] ?? '' );
	$prefix  = sprintf( '[wpdm-routine #%d] ', (int) ( $context['routine_id'] ?? 0 ) );

	// Suppress the actual error_log write inside the WP test
	// suite — every routine `log` step otherwise leaks a line to
	// stderr and pollutes the test runner's output. The step
	// still returns its payload so the executor's per-step log
	// captures the message; we just don't double-write it to
	// the PHP log when no human will read it.
	$running_in_wp_tests = ( defined( 'WP_TESTS_DOMAIN' ) || defined( 'WP_RUN_CORE_TESTS' ) );
	if ( ! $running_in_wp_tests ) {
		// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
		error_log( $prefix . strtoupper( $level ) . ': ' . $message );
	}

	return array( 'level' => $level, 'message' => $message );
}

/**
 * Wait step.
 *
 * Args: `seconds` (max 5 — synchronous routines must not stall a request).
 *
 * For longer waits, schedule a follow-up step via Action Scheduler
 * (Phase 2) — this built-in is just for the "throttle two API calls
 * a second" use case.
 *
 * @since 0.22.0
 *
 * @param array $args    Step args.
 * @param array $context Run context.
 * @return array
 */
function wpdm_routine_step_wait( $args, $context ) {
	$seconds = isset( $args['seconds'] ) ? (int) $args['seconds'] : 1;
	$seconds = max( 0, min( 5, $seconds ) );
	if ( $seconds > 0 ) {
		// Avoid sleeping inside test suites.
		if ( ! ( defined( 'WP_TESTS_DOMAIN' ) || ( defined( 'WP_RUN_CORE_TESTS' ) && WP_RUN_CORE_TESTS ) ) ) {
			sleep( $seconds );
		}
	}
	return array( 'waited_seconds' => $seconds );
}

/**
 * set_var step. Stores `args.value` under `args.name` in the run's
 * variable scope. `vars.<name>` resolves in subsequent placeholder
 * lookups.
 *
 * @since 0.22.0
 *
 * @param array $args    Step args.
 * @param array $context Run context.
 * @return array
 */
function wpdm_routine_step_set_var( $args, $context ) {
	$name  = isset( $args['name'] ) ? (string) $args['name'] : '';
	$value = $args['value'] ?? null;
	return array( '_set_var' => array( 'name' => $name, 'value' => $value ) );
}

/**
 * Stop step — cleanly aborts the routine with the given message.
 *
 * @since 0.22.0
 *
 * @param array $args    Step args.
 * @param array $context Run context.
 * @return array
 */
function wpdm_routine_step_stop( $args, $context ) {
	return array( '_stop' => true, 'reason' => (string) ( $args['reason'] ?? '' ) );
}

/**
 * Classify step — AI-powered text classification.
 *
 * Hands a chunk of text + a list of user-defined buckets to the
 * OpenAI Responses API with strict structured output, gets back
 * `{ bucket_id, confidence, reasoning }` for downstream steps.
 *
 * Args (all post placeholder-resolution):
 *
 *   - `input`   string   The text to classify. `{{payload.…}}` /
 *                        `{{vars.…}}` placeholders fully resolved
 *                        before the call.
 *   - `buckets` array    `[ { id: 'spam', description: 'Spam comments' }, … ]`.
 *                        At least 2 entries required.
 *   - `instructions` ?string  Extra system-prompt context (e.g.
 *                        site domain, audience). Optional.
 *
 * Returns `{ bucket_id, confidence, reasoning }` on success; the
 * routine's downstream steps reference `vars.<step.id>.bucket_id`
 * to branch on the result.
 *
 * Reuses the existing AI Copilot's HTTP layer — works with
 * whatever model/key the site already configured. Costs a real
 * API call per fire, so pair with rate limits / conditions
 * upstream when the trigger is high-volume.
 *
 * @since 0.22.0
 *
 * @param array $args    Resolved step args.
 * @param array $context Run context.
 * @return array|WP_Error
 */
function wpdm_routine_step_classify( $args, $context ) {
	$input = isset( $args['input'] ) ? (string) $args['input'] : '';
	if ( '' === trim( $input ) ) {
		return new WP_Error(
			'wpdm_routine_step_classify_empty_input',
			'Classify step needs a non-empty `input`.'
		);
	}

	$buckets = isset( $args['buckets'] ) && is_array( $args['buckets'] )
		? $args['buckets']
		: array();
	$normalised = array();
	foreach ( $buckets as $bucket ) {
		if ( ! is_array( $bucket ) ) {
			continue;
		}
		$id = isset( $bucket['id'] ) ? (string) $bucket['id'] : '';
		if ( '' === $id || ! preg_match( '/^[a-z0-9_\-]{1,64}$/i', $id ) ) {
			continue;
		}
		$normalised[] = array(
			'id'          => $id,
			'description' => isset( $bucket['description'] )
				? (string) $bucket['description']
				: '',
		);
	}
	if ( count( $normalised ) < 2 ) {
		return new WP_Error(
			'wpdm_routine_step_classify_buckets',
			'Classify step needs at least 2 buckets, each with a non-empty id.'
		);
	}

	$user_id = (int) ( $context['run_as_user_id'] ?? 0 );
	if (
		! function_exists( 'desktop_mode_ai_is_enabled' )
		|| ! desktop_mode_ai_is_enabled( $user_id )
	) {
		return new WP_Error(
			'wpdm_routine_step_classify_ai_disabled',
			'AI features are not enabled for the run-as user. Enable them in OS Settings → AI.'
		);
	}
	$api_key = (string) desktop_mode_ai_get_api_key( $user_id );
	if ( '' === $api_key ) {
		return new WP_Error(
			'wpdm_routine_step_classify_no_key',
			'No OpenAI API key configured for the run-as user.'
		);
	}

	$bucket_ids = array_column( $normalised, 'id' );
	$schema     = array(
		'type'                 => 'object',
		'additionalProperties' => false,
		'required'             => array( 'bucket_id', 'confidence', 'reasoning' ),
		'properties'           => array(
			'bucket_id'  => array(
				'type'        => 'string',
				'enum'        => $bucket_ids,
				'description' => 'The bucket the input belongs to.',
			),
			'confidence' => array(
				'type'        => 'number',
				'description' => 'Confidence in the classification, 0.0 to 1.0.',
			),
			'reasoning'  => array(
				'type'        => 'string',
				'description' => 'One-sentence rationale for the choice.',
			),
		),
	);

	$instructions = wpdm_routine_step_classify_build_instructions( $normalised, $args );
	$model        = (string) apply_filters(
		'desktop_mode_ai_model',
		defined( 'DESKTOP_MODE_AI_DEFAULT_MODEL' )
			? DESKTOP_MODE_AI_DEFAULT_MODEL
			: 'gpt-5.4-nano',
		'classify'
	);

	$body = array(
		'model'        => $model,
		'instructions' => $instructions,
		'input'        => array(
			array(
				'role'    => 'user',
				'content' => $input,
			),
		),
		'text'         => array(
			'format' => array(
				'type'   => 'json_schema',
				'name'   => 'classification',
				'strict' => true,
				'schema' => $schema,
			),
		),
	);

	$response = desktop_mode_ai_do_request( $api_key, $body );
	if ( is_wp_error( $response ) ) {
		return $response;
	}

	$json = wpdm_routine_ai_extract_json( $response );
	if ( is_wp_error( $json ) ) {
		return $json;
	}

	// Defence in depth — strict mode is reliable but not infallible.
	if (
		! is_array( $json )
		|| ! isset( $json['bucket_id'] )
		|| ! in_array( $json['bucket_id'], $bucket_ids, true )
	) {
		return new WP_Error(
			'wpdm_routine_step_classify_bad_bucket',
			'Classifier returned an unknown bucket id.',
			array( 'raw' => $json, 'expected_buckets' => $bucket_ids )
		);
	}

	/**
	 * Fires after a `classify` step completes.
	 *
	 * Useful for telemetry / cost tracking — every fire is a paid
	 * API call.
	 *
	 * @since 0.22.0
	 *
	 * @param array $result  `{ bucket_id, confidence, reasoning }`.
	 * @param array $context Run context.
	 * @param array $args    Resolved step args (input + buckets).
	 */
	do_action( 'wp_desktop_routine_step_classify_completed', $json, $context, $args );

	return array(
		'bucket_id'  => (string) $json['bucket_id'],
		'confidence' => is_numeric( $json['confidence'] ) ? (float) $json['confidence'] : 0.0,
		'reasoning'  => (string) ( $json['reasoning'] ?? '' ),
	);
}

/**
 * Build the system instructions for a classify call.
 *
 * @since 0.22.0
 * @internal
 *
 * @param array $buckets Normalised buckets.
 * @param array $args    Step args (for optional `instructions`).
 * @return string
 */
function wpdm_routine_step_classify_build_instructions( array $buckets, array $args ) {
	$lines = array();
	$lines[] = 'You are a classifier. Read the user-supplied text and return ONLY a JSON object matching the response schema.';
	$lines[] = '';
	$lines[] = 'Buckets:';
	foreach ( $buckets as $bucket ) {
		$lines[] = sprintf(
			'  - %s%s',
			$bucket['id'],
			'' !== $bucket['description'] ? ' — ' . $bucket['description'] : ''
		);
	}
	$lines[] = '';
	$lines[] = 'Pick exactly ONE bucket id. `confidence` is your numeric self-assessment (0.0 = guess, 1.0 = certain). `reasoning` is one sentence explaining the choice.';

	$extra = isset( $args['instructions'] ) ? (string) $args['instructions'] : '';
	if ( '' !== trim( $extra ) ) {
		$lines[] = '';
		$lines[] = 'Additional context from the routine author:';
		$lines[] = $extra;
	}
	return implode( "\n", $lines );
}
