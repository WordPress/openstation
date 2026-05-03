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
	// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_error_log
	error_log( $prefix . strtoupper( $level ) . ': ' . $message );
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
