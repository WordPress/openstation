<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_ELECTRON_HOST_META = 'openstation_electron_host';

const OPENSTATION_ELECTRON_REST_NS = 'openstation-electron/v1';

const OPENSTATION_ELECTRON_INTERVAL = 120;

const OPENSTATION_ELECTRON_TTL = 600;

const OPENSTATION_ELECTRON_PROTOCOL = 1;

function openstation_electron_enabled( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();

	return (bool) apply_filters( 'openstation_electron_enabled', $user_id > 0, $user_id );
}

function openstation_electron_interval() {

	$seconds = (int) apply_filters(
		'openstation_electron_heartbeat_interval',
		OPENSTATION_ELECTRON_INTERVAL
	);

	return max( 30, $seconds );
}

function openstation_electron_ttl() {

	$seconds = (int) apply_filters( 'openstation_electron_ttl', OPENSTATION_ELECTRON_TTL );

	return max( 2 * openstation_electron_interval(), $seconds );
}

function openstation_electron_os_label( $platform ) {
	switch ( $platform ) {
		case 'darwin':
			return __( 'Mac', 'openstation-electron-adapter' );
		case 'win32':
			return __( 'Windows PC', 'openstation-electron-adapter' );
		default:
			return __( 'Linux desktop', 'openstation-electron-adapter' );
	}
}

function openstation_electron_get_host( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();
	$empty   = array(
		'connected'   => false,
		'hostId'      => '',
		'platform'    => '',
		'osLabel'     => '',
		'appVersion'  => '',
		'protocol'    => 0,
		'lastSeen'    => 0,
		'connectedAt' => 0,
	);

	if ( ! $user_id ) {
		return $empty;
	}

	$raw = get_user_meta( $user_id, OPENSTATION_ELECTRON_HOST_META, true );
	if ( ! is_array( $raw ) || empty( $raw['hostId'] ) ) {
		return $empty;
	}

	$last_seen = isset( $raw['lastSeen'] ) ? (int) $raw['lastSeen'] : 0;
	if ( $last_seen <= 0 || ( time() - $last_seen ) > openstation_electron_ttl() ) {
		return $empty;
	}

	return array(
		'connected'   => true,
		'hostId'      => (string) $raw['hostId'],
		'platform'    => isset( $raw['platform'] ) ? (string) $raw['platform'] : '',
		'osLabel'     => isset( $raw['osLabel'] ) ? (string) $raw['osLabel'] : '',
		'appVersion'  => isset( $raw['appVersion'] ) ? (string) $raw['appVersion'] : '',
		'protocol'    => isset( $raw['protocol'] ) ? (int) $raw['protocol'] : 0,
		'lastSeen'    => $last_seen,
		'connectedAt' => isset( $raw['connectedAt'] ) ? (int) $raw['connectedAt'] : $last_seen,
		'agentUrl'    => isset( $raw['agentUrl'] ) ? (string) $raw['agentUrl'] : '',
		'agentToken'  => isset( $raw['agentToken'] ) ? (string) $raw['agentToken'] : '',
	);
}

function openstation_electron_sanitize_agent_url( $url ) {
	$url = trim( (string) $url );
	if ( '' === $url ) {
		return '';
	}

	$parts = wp_parse_url( $url );
	if ( ! is_array( $parts ) || empty( $parts['host'] ) || empty( $parts['port'] ) ) {
		return '';
	}
	if ( ! isset( $parts['scheme'] ) || 'http' !== $parts['scheme'] ) {
		return '';
	}
	if ( ! in_array( $parts['host'], array( '127.0.0.1', 'localhost', '[::1]', '::1' ), true ) ) {
		return '';
	}
	if ( ! empty( $parts['path'] ) && '/' !== $parts['path'] ) {
		return '';
	}

	$port = (int) $parts['port'];
	if ( $port < 1 || $port > 65535 ) {
		return '';
	}

	return 'http://' . $parts['host'] . ':' . $port;
}

function openstation_electron_set_host( $user_id, $args ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 || ! is_array( $args ) ) {
		return openstation_electron_get_host( 0 );
	}

	$host_id = isset( $args['hostId'] ) ? sanitize_key( (string) $args['hostId'] ) : '';
	if ( '' === $host_id ) {
		return openstation_electron_get_host( $user_id );
	}

	$existing = get_user_meta( $user_id, OPENSTATION_ELECTRON_HOST_META, true );
	$platform = isset( $args['platform'] ) ? sanitize_key( (string) $args['platform'] ) : '';
	$now      = time();

	$record = array(
		'hostId'      => $host_id,
		'platform'    => $platform,
		'osLabel'     => openstation_electron_os_label( $platform ),
		'appVersion'  => isset( $args['appVersion'] ) ? substr( sanitize_text_field( (string) $args['appVersion'] ), 0, 32 ) : '',
		'protocol'    => isset( $args['protocol'] ) ? (int) $args['protocol'] : 0,

		'agentUrl'    => array_key_exists( 'agentUrl', $args )
			? openstation_electron_sanitize_agent_url( $args['agentUrl'] )
			: ( is_array( $existing ) && isset( $existing['agentUrl'] ) ? (string) $existing['agentUrl'] : '' ),
		'agentToken'  => array_key_exists( 'agentToken', $args )
			? (string) preg_replace( '/[^a-f0-9]/', '', (string) $args['agentToken'] )
			: ( is_array( $existing ) && isset( $existing['agentToken'] ) ? (string) $existing['agentToken'] : '' ),
		'lastSeen'    => $now,

		'connectedAt' => ( is_array( $existing ) && ! empty( $existing['connectedAt'] ) && ! empty( $existing['hostId'] ) && $existing['hostId'] === $host_id )
			? (int) $existing['connectedAt']
			: $now,
	);

	update_user_meta( $user_id, OPENSTATION_ELECTRON_HOST_META, $record );

	return openstation_electron_get_host( $user_id );
}

function openstation_electron_clear_host( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	return (bool) delete_user_meta( $user_id, OPENSTATION_ELECTRON_HOST_META );
}

function openstation_electron_agent_pairing( $user_id ) {
	$record = openstation_electron_get_host( $user_id );

	if ( empty( $record['connected'] ) || empty( $record['agentUrl'] ) || empty( $record['agentToken'] ) ) {
		return array(
			'url'      => '',
			'hasAgent' => false,
		);
	}

	return array(
		'url'      => $record['agentUrl'],
		'token'    => $record['agentToken'],
		'hasAgent' => true,
		'osLabel'  => $record['osLabel'],
		'platform' => $record['platform'],
	);
}

function openstation_electron_config() {
	$user_id = get_current_user_id();
	$record  = openstation_electron_get_host( $user_id );

	$agent = openstation_electron_agent_pairing( $user_id );

	unset( $record['agentToken'] );

	$config = array(
		'enabled'   => openstation_electron_enabled( $user_id ),
		'restUrl'   => esc_url_raw( rest_url( OPENSTATION_ELECTRON_REST_NS . '/host' ) ),
		'restRoot'  => esc_url_raw( rest_url() ),
		'namespace' => OPENSTATION_ELECTRON_REST_NS,
		'interval'  => openstation_electron_interval() * 1000,
		'protocol'  => OPENSTATION_ELECTRON_PROTOCOL,
		'soloParam' => defined( 'OPENSTATION_SOLO_FLAG' ) ? OPENSTATION_SOLO_FLAG : 'openstation_solo',
		'agent'     => $agent,
		'last'      => $record,
	);

	return (array) apply_filters( 'openstation_electron_config', $config, $user_id );
}

function openstation_electron_rest_permission() {
	if ( function_exists( 'openstation_rest_require_enabled' ) ) {
		return openstation_rest_require_enabled();
	}
	return is_user_logged_in();
}

function openstation_electron_register_routes() {
	register_rest_route(
		OPENSTATION_ELECTRON_REST_NS,
		'/host',
		array(
			array(
				'methods'             => 'GET',
				'callback'            => 'openstation_electron_rest_get_host',
				'permission_callback' => 'openstation_electron_rest_permission',
			),
			array(
				'methods'             => 'DELETE',
				'callback'            => 'openstation_electron_rest_disconnect',
				'permission_callback' => 'openstation_electron_rest_permission',
			),
		)
	);

	register_rest_route(
		OPENSTATION_ELECTRON_REST_NS,
		'/host/handshake',
		array(
			'methods'             => 'POST',
			'callback'            => 'openstation_electron_rest_handshake',
			'permission_callback' => 'openstation_electron_rest_permission',
			'args'                => array(
				'hostId'     => array(
					'type'        => 'string',
					'required'    => true,
					'description' => __( 'Stable per-installation identifier generated by the host app.', 'openstation-electron-adapter' ),
				),
				'platform'   => array(
					'type'        => 'string',
					'description' => __( 'Host operating system, as reported by the app.', 'openstation-electron-adapter' ),
				),
				'appVersion' => array(
					'type'        => 'string',
					'description' => __( 'Host app version.', 'openstation-electron-adapter' ),
				),
				'protocol'   => array(
					'type'        => 'integer',
					'description' => __( 'Host protocol version.', 'openstation-electron-adapter' ),
				),
				'agentUrl'   => array(
					'type'        => 'string',
					'description' => __( 'Loopback URL of the app\'s local agent, so browser tabs can reach this machine.', 'openstation-electron-adapter' ),
				),
				'agentToken' => array(
					'type'        => 'string',
					'description' => __( 'Bearer token the local agent requires.', 'openstation-electron-adapter' ),
				),
			),
		)
	);

	register_rest_route(
		OPENSTATION_ELECTRON_REST_NS,
		'/host/heartbeat',
		array(
			'methods'             => 'POST',
			'callback'            => 'openstation_electron_rest_heartbeat',
			'permission_callback' => 'openstation_electron_rest_permission',
			'args'                => array(
				'hostId' => array(
					'type'        => 'string',
					'description' => __( 'Identifier from the handshake.', 'openstation-electron-adapter' ),
				),
			),
		)
	);

	register_rest_route(
		OPENSTATION_ELECTRON_REST_NS,
		'/host/disconnect',
		array(
			'methods'             => 'POST',
			'callback'            => 'openstation_electron_rest_disconnect',
			'permission_callback' => 'openstation_electron_rest_permission',
		)
	);
}
add_action( 'rest_api_init', 'openstation_electron_register_routes' );

function openstation_electron_rest_get_host() {
	$user_id = get_current_user_id();
	$record  = openstation_electron_get_host( $user_id );

	$agent = openstation_electron_agent_pairing( $user_id );
	unset( $record['agentToken'] );

	return rest_ensure_response(
		array_merge(
			$record,
			array(
				'heartbeatInterval' => openstation_electron_interval() * 1000,
				'protocol'          => OPENSTATION_ELECTRON_PROTOCOL,
				'agent'             => $agent,
			)
		)
	);
}

function openstation_electron_rest_handshake( $request ) {
	$user_id = get_current_user_id();

	if ( ! openstation_electron_enabled( $user_id ) ) {
		return new WP_Error(
			'openstation_electron_disabled',
			__( 'Desktop hosts are not available for this account.', 'openstation-electron-adapter' ),
			array( 'status' => 403 )
		);
	}

	$protocol = (int) $request->get_param( 'protocol' );
	if ( $protocol > OPENSTATION_ELECTRON_PROTOCOL ) {

		return new WP_Error(
			'openstation_electron_protocol',
			__( 'This site does not understand that version of the desktop app yet. Update the adapter.', 'openstation-electron-adapter' ),
			array(
				'status'   => 400,
				'protocol' => OPENSTATION_ELECTRON_PROTOCOL,
			)
		);
	}

	$record = openstation_electron_set_host(
		$user_id,
		array(
			'hostId'     => $request->get_param( 'hostId' ),
			'platform'   => $request->get_param( 'platform' ),
			'appVersion' => $request->get_param( 'appVersion' ),
			'protocol'   => $protocol,
			'agentUrl'   => (string) $request->get_param( 'agentUrl' ),
			'agentToken' => (string) $request->get_param( 'agentToken' ),
		)
	);

	if ( empty( $record['connected'] ) ) {
		return new WP_Error(
			'openstation_electron_invalid',
			__( 'The host identifier was missing or unusable.', 'openstation-electron-adapter' ),
			array( 'status' => 400 )
		);
	}

	do_action( 'openstation_electron_host_connected', $record, $user_id );

	$user = wp_get_current_user();

	return rest_ensure_response(
		array_merge(
			$record,
			array(
				'heartbeatInterval' => openstation_electron_interval() * 1000,
				'protocol'          => OPENSTATION_ELECTRON_PROTOCOL,
				'site'              => get_bloginfo( 'name' ),
				'user'              => $user ? $user->display_name : '',
			)
		)
	);
}

function openstation_electron_rest_heartbeat( $request ) {
	$user_id = get_current_user_id();

	if ( ! openstation_electron_enabled( $user_id ) ) {
		return new WP_Error(
			'openstation_electron_disabled',
			__( 'Desktop hosts are not available for this account.', 'openstation-electron-adapter' ),
			array( 'status' => 403 )
		);
	}

	$host_id  = (string) $request->get_param( 'hostId' );
	$existing = openstation_electron_get_host( $user_id );

	$record = openstation_electron_set_host(
		$user_id,
		array(
			'hostId'     => '' !== $host_id ? $host_id : $existing['hostId'],
			'platform'   => $existing['platform'],
			'appVersion' => $existing['appVersion'],
			'protocol'   => $existing['protocol'],
		)
	);

	if ( empty( $record['connected'] ) ) {
		return new WP_Error(
			'openstation_electron_unknown',
			__( 'No desktop host is registered for this account.', 'openstation-electron-adapter' ),
			array( 'status' => 400 )
		);
	}

	do_action( 'openstation_electron_host_heartbeat', $record, $user_id );

	return rest_ensure_response(
		array_merge(
			$record,
			array( 'heartbeatInterval' => openstation_electron_interval() * 1000 )
		)
	);
}

function openstation_electron_rest_disconnect() {
	$user_id = get_current_user_id();
	$record  = openstation_electron_get_host( $user_id );

	openstation_electron_clear_host( $user_id );

	if ( ! empty( $record['connected'] ) ) {

		do_action( 'openstation_electron_host_disconnected', $record, $user_id );
	}

	return rest_ensure_response( openstation_electron_get_host( $user_id ) );
}
