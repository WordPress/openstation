<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_DEBUG_RING_SIZE = 500;

const OPENSTATION_DEBUG_SESSION_TTL = 3600;

function openstation_debug_transient_key( $session_id, $channel ) {
	return 'openstation_dbg_' . md5( (string) $session_id . '|' . (string) $channel );
}

function openstation_debug_session_for_request() {
	$raw = '';
	if ( isset( $_SERVER['HTTP_X_WP_DEBUG_SESSION'] ) ) {
		$raw = sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_DEBUG_SESSION'] ) );
	}
	$raw = trim( $raw );
	if ( '' === $raw ) {
		return '';
	}

	$sanitised = preg_replace( '/[^A-Za-z0-9\-]/', '', $raw );
	if ( ! is_string( $sanitised ) || '' === $sanitised || strlen( $sanitised ) > 64 ) {
		return '';
	}
	return $sanitised;
}

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

	do_action( 'openstation_debug_publish', $session_id, $channel, $payload );
	return true;
}

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

function openstation_rest_debug_drain( WP_REST_Request $request ) {
	$session_id = (string) $request->get_param( 'sessionId' );
	$since      = (int) $request->get_param( 'since' );
	$channel    = $request->get_param( 'channel' );
	$channels   = $request->get_param( 'channels' );

	if ( is_array( $channels ) && count( $channels ) > 0 ) {

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

function openstation_rest_debug_permission() {
	$allowed = is_user_logged_in() && current_user_can( 'manage_options' );

	return (bool) apply_filters( 'openstation_debug_rest_permission', $allowed );
}

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
