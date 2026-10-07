<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_OAUTH_TRANSIENT_PREFIX = 'desktop_mode_oauth_state_';
const OPENSTATION_OAUTH_STATE_TTL        = 600;

function openstation_register_oauth_relay( $service, $args = array() ) {
	$service = sanitize_key( (string) $service );
	if ( '' === $service ) {
		return new WP_Error(
			'openstation_oauth_missing_service',
			__( 'OAuth relay registration requires a non-empty service slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'authorize_url' => '',
		'token_url'     => '',
		'client_id'     => '',
		'client_secret' => '',
		'scope'         => '',
		'on_success'    => null,
		'capabilities'  => array( 'read' ),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( array( 'authorize_url', 'token_url', 'client_id', 'client_secret' ) as $required ) {
		if ( '' === (string) $args[ $required ] ) {
			return new WP_Error(
				'openstation_oauth_missing_' . $required,

				sprintf( __( 'OAuth relay registration requires a non-empty `%s`.', 'desktop-mode' ), $required ),
				array( 'service' => $service )
			);
		}
	}

	if ( ! is_callable( $args['on_success'] ) ) {
		return new WP_Error(
			'openstation_oauth_missing_on_success',
			__( 'OAuth relay registration requires a callable `on_success` handler.', 'desktop-mode' ),
			array( 'service' => $service )
		);
	}

	$authorize_url = esc_url_raw( (string) $args['authorize_url'], array( 'http', 'https' ) );
	$token_url     = esc_url_raw( (string) $args['token_url'], array( 'http', 'https' ) );
	if ( '' === $authorize_url || '' === $token_url ) {
		return new WP_Error(
			'openstation_oauth_invalid_url',
			__( 'OAuth relay `authorize_url` and `token_url` must be valid http(s) URLs.', 'desktop-mode' ),
			array( 'service' => $service )
		);
	}

	$entry = array(
		'service'       => $service,
		'authorize_url' => $authorize_url,
		'token_url'     => $token_url,
		'client_id'     => (string) $args['client_id'],
		'client_secret' => (string) $args['client_secret'],
		'scope'         => (string) $args['scope'],
		'on_success'    => $args['on_success'],
		'capabilities'  => array_values( array_filter( array_map( 'strval', (array) $args['capabilities'] ) ) ),
	);
	openstation_oauth_relay_registry( $service, $entry );

	do_action(
		'openstation_oauth_relay_registered',
		$service,
		array_merge( $entry, array( 'client_secret' => '[redacted]' ) )
	);

	return true;
}

function openstation_oauth_relay_registry( $service = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $service ) {
		return $store;
	}
	if ( '__unset__' === $entry ) {
		unset( $store[ $service ] );
		return null;
	}
	if ( null !== $entry ) {
		$store[ $service ] = $entry;
	}
	return isset( $store[ $service ] ) ? $store[ $service ] : null;
}

function openstation_unregister_oauth_relay( $service ) {
	$service = sanitize_key( (string) $service );
	if ( '' === $service ) {
		return;
	}
	openstation_oauth_relay_registry( $service, '__unset__' );
}

function openstation_oauth_redirect_uri() {
	return rest_url( 'desktop-mode/v1/oauth/callback' );
}

function openstation_oauth_issue_state( $user_id, $service ) {

	$state = wp_generate_password( 32, false );
	set_transient(
		OPENSTATION_OAUTH_TRANSIENT_PREFIX . $state,
		array(
			'user_id' => (int) $user_id,
			'service' => (string) $service,
			'issued'  => time(),
		),
		OPENSTATION_OAUTH_STATE_TTL
	);
	return $state;
}

function openstation_oauth_consume_state( $state ) {
	$state = (string) $state;
	if ( '' === $state ) {
		return null;
	}
	$key   = OPENSTATION_OAUTH_TRANSIENT_PREFIX . $state;
	$entry = get_transient( $key );
	if ( ! is_array( $entry ) || empty( $entry['user_id'] ) || empty( $entry['service'] ) ) {
		return null;
	}
	delete_transient( $key );
	return array(
		'user_id' => (int) $entry['user_id'],
		'service' => (string) $entry['service'],
		'issued'  => isset( $entry['issued'] ) ? (int) $entry['issued'] : 0,
	);
}

function openstation_rest_oauth_start( WP_REST_Request $request ) {
	$service = sanitize_key( (string) $request->get_param( 'service' ) );
	$entry   = openstation_oauth_relay_registry( $service );
	if ( ! is_array( $entry ) ) {
		return new WP_Error(
			'openstation_oauth_unknown_service',
			__( 'No OAuth relay is registered for that service.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}

	foreach ( $entry['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return new WP_Error(
				'openstation_oauth_capability_denied',
				__( 'Current user lacks the capability required to start this OAuth flow.', 'desktop-mode' ),
				array( 'status' => 403 )
			);
		}
	}

	$user_id = get_current_user_id();
	$state   = openstation_oauth_issue_state( $user_id, $service );

	$query = array(
		'response_type' => 'code',
		'client_id'     => $entry['client_id'],
		'redirect_uri'  => openstation_oauth_redirect_uri(),
		'state'         => $state,
	);
	if ( '' !== $entry['scope'] ) {
		$query['scope'] = $entry['scope'];
	}

	$query = apply_filters(
		'openstation_oauth_authorize_query',
		$query,
		$service,
		array_merge( $entry, array( 'client_secret' => '[redacted]' ) )
	);

	$authorize_url = add_query_arg( array_map( 'rawurlencode', $query ), $entry['authorize_url'] );

	return rest_ensure_response(
		array(
			'authorize_url' => $authorize_url,
			'state'         => $state,
		)
	);
}

function openstation_rest_oauth_callback( WP_REST_Request $request ) {
	$state = (string) $request->get_param( 'state' );
	$code  = (string) $request->get_param( 'code' );
	$error = (string) $request->get_param( 'error' );

	$consumed = openstation_oauth_consume_state( $state );
	if ( null === $consumed ) {
		return openstation_oauth_render_callback_html(
			array(
				'ok'      => false,
				'reason'  => 'invalid_state',
				'message' => __( 'OAuth state nonce missing, expired, or already used.', 'desktop-mode' ),
			)
		);
	}
	$service = $consumed['service'];
	$user_id = $consumed['user_id'];

	if ( '' !== $error ) {
		return openstation_oauth_render_callback_html(
			array(
				'ok'      => false,
				'service' => $service,
				'reason'  => 'authorize_denied',
				'message' => $error,
			)
		);
	}

	$entry = openstation_oauth_relay_registry( $service );
	if ( ! is_array( $entry ) ) {
		return openstation_oauth_render_callback_html(
			array(
				'ok'      => false,
				'reason'  => 'unknown_service',
				'message' => __( 'OAuth relay is no longer registered for that service.', 'desktop-mode' ),
			)
		);
	}

	if ( '' === $code ) {
		return openstation_oauth_render_callback_html(
			array(
				'ok'      => false,
				'service' => $service,
				'reason'  => 'missing_code',
				'message' => __( 'OAuth callback did not return an authorization code.', 'desktop-mode' ),
			)
		);
	}

	$response = wp_remote_post(
		$entry['token_url'],
		array(
			'timeout' => 15,
			'body'    => array(
				'grant_type'    => 'authorization_code',
				'code'          => $code,
				'client_id'     => $entry['client_id'],
				'client_secret' => $entry['client_secret'],
				'redirect_uri'  => openstation_oauth_redirect_uri(),
			),
			'headers' => array( 'Accept' => 'application/json' ),
		)
	);
	if ( is_wp_error( $response ) ) {
		return openstation_oauth_render_callback_html(
			array(
				'ok'      => false,
				'service' => $service,
				'reason'  => 'token_request_failed',
				'message' => $response->get_error_message(),
			)
		);
	}
	$status = (int) wp_remote_retrieve_response_code( $response );
	$body   = wp_remote_retrieve_body( $response );
	$tokens = json_decode( $body, true );
	if ( $status < 200 || $status >= 300 || ! is_array( $tokens ) ) {
		return openstation_oauth_render_callback_html(
			array(
				'ok'      => false,
				'service' => $service,
				'reason'  => 'token_exchange_failed',
				'message' => sprintf(

					__( 'Token exchange failed with HTTP %d.', 'desktop-mode' ),
					$status
				),
			)
		);
	}

	try {
		call_user_func( $entry['on_success'], $user_id, $tokens, $service );
	} catch ( \Throwable $e ) {
		return openstation_oauth_render_callback_html(
			array(
				'ok'      => false,
				'service' => $service,
				'reason'  => 'on_success_threw',
				'message' => $e->getMessage(),
			)
		);
	}

	do_action( 'openstation_oauth_relay_connected', $service, $user_id );

	return openstation_oauth_render_callback_html(
		array(
			'ok'      => true,
			'service' => $service,
		)
	);
}

function openstation_oauth_build_callback_html( array $payload ) {

	$payload_literal = wp_json_encode( $payload, JSON_HEX_TAG | JSON_UNESCAPED_SLASHES );
	$origin_literal  = wp_json_encode( site_url(), JSON_HEX_TAG | JSON_UNESCAPED_SLASHES );

	return "<!doctype html>
<html lang=\"en\">
<head>
<meta charset=\"utf-8\">
<title>OAuth Callback</title>
<style>
body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #1d2327; }
</style>
</head>
<body>
<p>Authorization complete. You can close this window.</p>
<script>
( function () {
    try {
        if ( window.opener ) {
            window.opener.postMessage(
                { type: 'os-oauth-callback', payload: {$payload_literal} },
                {$origin_literal}
            );
        }
    } catch ( e ) {}
    setTimeout( function () { window.close(); }, 250 );
} )();
</script>
</body>
</html>";
}

function openstation_oauth_render_callback_html( array $payload ) {
	$html = openstation_oauth_build_callback_html( $payload );

	$filter_cb = null;
	$filter_cb = static function ( $served, $result, $request ) use ( $html, &$filter_cb ) {

		if (
			! $request instanceof WP_REST_Request
			|| '/desktop-mode/v1/oauth/callback' !== $request->get_route()
		) {
			return $served;
		}

		if ( $filter_cb ) {
			remove_filter( 'rest_pre_serve_request', $filter_cb, 10 );
		}
		if ( ! headers_sent() ) {
			header( 'Content-Type: text/html; charset=utf-8' );
		}

		echo $html;

		return true;
	};
	add_filter( 'rest_pre_serve_request', $filter_cb, 10, 3 );

	$response = new WP_REST_Response( $html );
	$response->header( 'Content-Type', 'text/html; charset=utf-8' );
	return $response;
}

function openstation_rest_oauth_start_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'You must be logged in to start an OAuth flow.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}
	return true;
}

function openstation_register_oauth_rest_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/oauth/start',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_oauth_start',
			'permission_callback' => 'openstation_rest_oauth_start_permission',
			'args'                => array(
				'service' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/oauth/callback',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_rest_oauth_callback',

			'permission_callback' => '__return_true',
			'args'                => array(
				'state' => array(
					'required' => true,
					'type'     => 'string',
				),
				'code'  => array(
					'required' => false,
					'type'     => 'string',
				),
				'error' => array(
					'required' => false,
					'type'     => 'string',
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_oauth_rest_routes' );
