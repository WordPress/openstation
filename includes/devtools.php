<?php
/**
 * OpenStation — DevTools / debug bus.
 *
 * Provides a generic per-session pub/sub channel that plugins use to
 * stream debug data (SQL queries, HTTP timings, hook traces, custom
 * events) from a server-side capture into a client-side inspector
 * window.
 *
 * Architecture:
 *
 *   1. Inspector plugin allocates a session id with
 *      `wp.os.devtools.debug.startSession()` and decides which
 *      channels it cares about (`'query'`, `'log'`, …).
 *   2. Inspector contributes `X-WP-Debug-Session: <id>` to the
 *      target window via
 *      `wp.os.devtools.addRequestHeader( windowId, 'X-WP-Debug-Session', sessionId )`.
 *   3. The target window's iframe attaches that header to every
 *      fetch / XHR / sendBeacon (the chromeless inline bridge merges
 *      contributed headers into outgoing requests).
 *   4. Server-side capture hooks read the header via
 *      {@see openstation_debug_session_for_request()}, run their
 *      capture (SAVEQUERIES, output buffering, etc.), and publish via
 *      {@see openstation_debug_publish()}.
 *   5. Inspector subscribes via
 *      `wp.os.devtools.debug.subscribe( sessionId, channel, cb )`.
 *      The shell polls `GET /desktop-mode/v1/debug` every second and
 *      replays new events to subscribers.
 *
 * Storage: a per-session ring buffer in a transient. Bounded by
 * {@see OPENSTATION_DEBUG_RING_SIZE} so a misconfigured capture
 * loop can't fill the database. TTL is 1 hour — long enough for an
 * inspector session to span a few page loads, short enough that
 * abandoned sessions don't squat indefinitely.
 *
 * Capability gate: every public surface requires the caller to be
 * logged-in AND hold `manage_options`. Debug data leaks request /
 * response details (query parameters, internal IDs) — locking it to
 * site admins matches the cost of getting that wrong.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Maximum number of events kept per (session, channel) ring buffer.
 *
 * A 500-event cap means a chatty SQL capture ((100 queries / page) × 5
 * page loads) survives on the buffer without truncation. Anything
 * higher and a single transient row starts to push the row-size
 * sanity threshold for typical wp_options storage.
 */
const OPENSTATION_DEBUG_RING_SIZE = 500;

/**
 * Transient TTL for a session ring buffer, in seconds.
 *
 * One hour. Inspector windows that stay open longer than that should
 * heartbeat by republishing — at which point the TTL extends.
 */
const OPENSTATION_DEBUG_SESSION_TTL = 3600;

/**
 * Build the transient key for a (session, channel) pair.
 *
 * @param string $session_id Session id (as supplied by the client).
 * @param string $channel    Channel name (`'query'`, `'log'`, …).
 * @return string Transient key safe for `set_transient`.
 */
function openstation_debug_transient_key( $session_id, $channel ) {
	return 'openstation_dbg_' . md5( (string) $session_id . '|' . (string) $channel );
}

/**
 * Read the debug session id from the current request's headers.
 *
 * Plugins running inside an admin request (chromeless iframe load,
 * admin-ajax, REST request) call this to detect whether the request
 * originated from an instrumented window. Returns an empty string
 * when no session id is attached or the value fails sanitisation.
 *
 * The header is sanitised with a case-preserving alphanumeric+dash
 * filter (`sanitize_key()` would lowercase, breaking UUID v4
 * round-trips); values longer than 64 characters are rejected —
 * a tight gate for `crypto.randomUUID()`-shaped ids.
 *
 * @return string Session id, or '' when absent / invalid.
 */
function openstation_debug_session_for_request() {
	$raw = '';
	if ( isset( $_SERVER['HTTP_X_WP_DEBUG_SESSION'] ) ) {
		$raw = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_DEBUG_SESSION'] ) );
	}
	$raw = trim( $raw );
	if ( '' === $raw ) {
		return '';
	}
	// `sanitize_key()` lowercases — preserve case so UUID v4 strings
	// round-trip cleanly. Replace anything that isn't alnum/dash.
	$sanitised = preg_replace( '/[^A-Za-z0-9\-]/', '', $raw );
	if ( ! is_string( $sanitised ) || '' === $sanitised || strlen( $sanitised ) > 64 ) {
		return '';
	}
	return $sanitised;
}

/**
 * Publish a payload onto a (session, channel).
 *
 * The newest event is appended to the ring buffer; once the cap is
 * reached, the oldest events are dropped FIFO. Fires the
 * `openstation_debug_publish` action so observability widgets can
 * tail the stream synchronously without going through the REST poll.
 *
 * @param string $session_id Session id from the client.
 * @param string $channel    Channel name. Free-form; convention is
 *                            lowercase ASCII (e.g. `'query'`,
 *                            `'log'`, `'rest_timing'`).
 * @param mixed  $payload    Anything `wp_json_encode()` can serialise.
 * @return bool True when the event was appended (queued for storage);
 *              false only when `$session_id` or `$channel` is empty.
 *              `set_transient()` failures are not detected.
 */
function openstation_debug_publish( $session_id, $channel, $payload ) {
	$session_id = (string) $session_id;
	$channel    = (string) $channel;
	if ( '' === $session_id || '' === $channel ) {
		return false;
	}
	$key      = openstation_debug_transient_key( $session_id, $channel );
	$existing = get_transient( $key );
	if ( ! is_array( $existing ) ) {
		$existing = array(
			'next_id' => 0,
			'events'  => array(),
		);
	}
	$next_id = isset( $existing['next_id'] ) ? (int) $existing['next_id'] : 0;
	++$next_id;
	$existing['next_id']  = $next_id;
	$existing['events'][] = array(
		'id'      => $next_id,
		't'       => (int) round( microtime( true ) * 1000 ),
		'channel' => $channel,
		'payload' => $payload,
	);
	$max                  = (int) apply_filters( 'openstation_debug_ring_size', OPENSTATION_DEBUG_RING_SIZE );
	if ( $max < 1 ) {
		$max = OPENSTATION_DEBUG_RING_SIZE;
	}
	if ( count( $existing['events'] ) > $max ) {
		$existing['events'] = array_slice( $existing['events'], -$max );
	}
	set_transient( $key, $existing, OPENSTATION_DEBUG_SESSION_TTL );

	/**
	 * Fires after a debug event is appended to the ring buffer.
	 *
	 * Lets observability hooks tail the stream synchronously instead
	 * of polling the REST endpoint. The arguments mirror the JS-side
	 * `DebugEvent` shape minus the auto-assigned id / timestamp.
	 *
	 * @param string $session_id Session id from the publishing call.
	 * @param string $channel    Channel name.
	 * @param mixed  $payload    Published payload.
	 */
	do_action( 'openstation_debug_publish', $session_id, $channel, $payload );
	return true;
}

/**
 * Drain events newer than `$since` for a session, optionally
 * narrowed to one channel.
 *
 * Returns `array( 'events' => [], 'cursor' => N )`. The cursor is the
 * highest event id seen across all returned events; clients pass it
 * back as `since` on the next poll.
 *
 * @param string      $session_id Session id.
 * @param int         $since      Highest id the client has seen.
 * @param string|null $channel    Optional channel filter.
 * @return array
 */
function openstation_debug_drain( $session_id, $since = 0, $channel = null ) {
	$session_id = (string) $session_id;
	if ( '' === $session_id ) {
		return array(
			'events' => array(),
			'cursor' => (int) $since,
		);
	}

	$channels = array();
	if ( null !== $channel && '' !== (string) $channel ) {
		$channels[] = (string) $channel;
	} else {
		// Without a channel filter the client wants every channel for
		// this session. We don't keep an index of channels per session
		// (would double-write on every publish); instead we let the
		// caller pass a list, OR fan out via the
		// `openstation_debug_channels` filter for plugins that know
		// their full set up-front.
		$declared = apply_filters( 'openstation_debug_channels', array(), $session_id );
		if ( is_array( $declared ) ) {
			foreach ( $declared as $ch ) {
				if ( is_string( $ch ) && '' !== $ch ) {
					$channels[] = $ch;
				}
			}
		}
	}

	$cursor = (int) $since;
	$out    = array();
	foreach ( $channels as $ch ) {
		$key  = openstation_debug_transient_key( $session_id, $ch );
		$data = get_transient( $key );
		if ( ! is_array( $data ) || empty( $data['events'] ) ) {
			continue;
		}
		foreach ( $data['events'] as $ev ) {
			if ( ! is_array( $ev ) || ! isset( $ev['id'] ) ) {
				continue;
			}
			if ( (int) $ev['id'] <= (int) $since ) {
				continue;
			}
			$out[] = $ev;
			if ( (int) $ev['id'] > $cursor ) {
				$cursor = (int) $ev['id'];
			}
		}
	}

	// Stable sort by event id so a multi-channel response is in
	// publication order rather than channel-iteration order. usort()
	// in PHP 8+ is stable; this matches the JS-side expectation.
	usort(
		$out,
		static function ( $a, $b ) {
			return ( (int) $a['id'] ) - ( (int) $b['id'] );
		}
	);
	return array(
		'events' => $out,
		'cursor' => $cursor,
	);
}

/**
 * REST: GET /desktop-mode/v1/debug
 *
 * Returns events newer than `since` for the given session id.
 * Supports both `channel=foo` (single) and `channels[]=foo&channels[]=bar`
 * (list); falls back to the `openstation_debug_channels` filter
 * when no channel param is supplied.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function openstation_rest_debug_drain( WP_REST_Request $request ) {
	$session_id = (string) $request->get_param( 'sessionId' );
	$since      = (int) $request->get_param( 'since' );
	$channel    = $request->get_param( 'channel' );
	$channels   = $request->get_param( 'channels' );

	if ( is_array( $channels ) && count( $channels ) > 0 ) {
		// Multi-channel drain — concatenate the per-channel results.
		$cursor     = $since;
		$all_events = array();
		foreach ( $channels as $ch ) {
			$result = openstation_debug_drain( $session_id, $since, (string) $ch );
			foreach ( $result['events'] as $ev ) {
				$all_events[] = $ev;
			}
			if ( $result['cursor'] > $cursor ) {
				$cursor = $result['cursor'];
			}
		}
		usort(
			$all_events,
			static function ( $a, $b ) {
				return ( (int) $a['id'] ) - ( (int) $b['id'] );
			}
		);
		return rest_ensure_response(
			array(
				'events' => $all_events,
				'cursor' => $cursor,
			)
		);
	}

	$result = openstation_debug_drain(
		$session_id,
		$since,
		is_string( $channel ) ? $channel : null
	);
	return rest_ensure_response( $result );
}

/**
 * Permission gate for the debug REST endpoint.
 *
 * Logged-in admins only — debug data exposes internal request shapes
 * that should never leak to lower-privileged users. Plugins that need
 * to relax this for a specific session can hook the
 * `openstation_debug_rest_permission` filter (filters TRUE/FALSE).
 *
 * @return bool
 */
function openstation_rest_debug_permission() {
	$allowed = is_user_logged_in() && current_user_can( 'manage_options' );
	/**
	 * Filter the permission decision for the debug REST endpoint.
	 *
	 * @param bool $allowed Default: caller is a logged-in admin.
	 */
	return (bool) apply_filters( 'openstation_debug_rest_permission', $allowed );
}

/**
 * Register the debug REST routes.
 */
function openstation_register_debug_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/debug',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_rest_debug_drain',
				'permission_callback' => 'openstation_rest_debug_permission',
				'args'                => array(
					'sessionId' => array(
						'required' => true,
						'type'     => 'string',
					),
					'since'     => array(
						'type'    => 'integer',
						'default' => 0,
					),
					'channel'   => array(
						'type' => 'string',
					),
					'channels'  => array(
						'type'  => 'array',
						'items' => array( 'type' => 'string' ),
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_debug_rest_routes' );
