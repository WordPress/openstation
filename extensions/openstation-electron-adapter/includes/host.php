<?php
/**
 * Electron Adapter — the host contract.
 *
 * The server's half of an optional extra: when the user is looking at
 * OpenStation through the desktop app rather than a browser tab, the
 * app introduces itself here and keeps a slow liveness pulse going.
 *
 * ## What a server-side record buys
 *
 * Deliberately little — the *shell* detects the host directly, through
 * a JavaScript global the app injects, which is instant, free, and
 * cannot get out of sync. What the server adds is what one page's
 * JavaScript cannot see:
 *
 *   - other requests (a plugin rendering an admin screen, a
 *     notification decision) can ask whether this user has a desktop
 *     attached;
 *   - the record survives a shell reload, so a native window that
 *     outlives the page that created it is still attributable;
 *   - `openstation_electron_host_connected` / `_heartbeat` /
 *     `_disconnected` give other plugins something to react to.
 *
 * Note what is NOT claimed anywhere: that a host is attached *right
 * now*. The same user can have the site open in a browser tab at the
 * same moment, so only the client's probe can answer that honestly.
 *
 * ## Being cheap on cheap hosting
 *
 * Every beat is a real PHP request, and plenty of WordPress sites run
 * on shared hosting where that matters. Three choices keep it near
 * free:
 *
 *   1. **The interval is the server's to set.** The handshake and
 *      every heartbeat response carry it, so a busy site can widen the
 *      pulse to ten minutes via
 *      `openstation_electron_heartbeat_interval` and the change takes
 *      effect within one beat — no new build of the app.
 *   2. **One user-meta row.** No custom table, no autoloaded option,
 *      no post type. A beat is a single `update_user_meta()` on a row
 *      already in the object cache for a logged-in request.
 *   3. **Expiry is read-time, not cron.** A stale record simply reads
 *      as disconnected; nothing is scheduled to clean it up.
 *
 * @package OpenStationElectronAdapter
 */

defined( 'ABSPATH' ) || exit;

/** User-meta key holding the current host record. */
const OPENSTATION_ELECTRON_HOST_META = 'openstation_electron_host';

/** REST namespace. Separate from core's — this is a separate plugin. */
const OPENSTATION_ELECTRON_REST_NS = 'openstation-electron/v1';

/** Default seconds between liveness beats. */
const OPENSTATION_ELECTRON_INTERVAL = 120;

/**
 * Seconds a record stays valid without a beat.
 *
 * Deliberately several intervals wide. A host that misses one beat
 * because a laptop lid closed for ninety seconds has not gone away,
 * and flapping the connection state costs more — in hook noise, in UI
 * repaints — than carrying a slightly stale record does.
 */
const OPENSTATION_ELECTRON_TTL = 600;

/** Highest protocol version this plugin knows how to talk. */
const OPENSTATION_ELECTRON_PROTOCOL = 1;

/**
 * Whether this user may attach a native desktop host at all.
 *
 * @param int $user_id User ID. Falls back to the current user when 0.
 * @return bool True when the user may register a host.
 */
function openstation_electron_enabled( $user_id = 0 ) {
	$user_id = $user_id ? (int) $user_id : get_current_user_id();

	/**
	 * Filter whether a user may attach a native desktop host.
	 *
	 * @param bool $enabled Default — true for any logged-in user.
	 * @param int  $user_id The user in question.
	 */
	return (bool) apply_filters( 'openstation_electron_enabled', $user_id > 0, $user_id );
}

/**
 * Seconds the desktop host should wait between liveness beats.
 *
 * @return int Interval in seconds. Never below 30.
 */
function openstation_electron_interval() {
	/**
	 * Filter the liveness-beat interval handed to the desktop host.
	 *
	 * Raise this on constrained hosting — the app re-reads it from
	 * every response, so a change lands within one beat.
	 *
	 * @param int $seconds Default 120.
	 */
	$seconds = (int) apply_filters(
		'openstation_electron_heartbeat_interval',
		OPENSTATION_ELECTRON_INTERVAL
	);

	return max( 30, $seconds );
}

/**
 * Seconds a host record survives without a beat.
 *
 * @return int TTL in seconds. Always at least two intervals wide, so a
 *             filter that widens the interval cannot accidentally make
 *             every host look permanently disconnected.
 */
function openstation_electron_ttl() {
	/**
	 * Filter how long a host record stays valid without a beat.
	 *
	 * @param int $seconds Default 600.
	 */
	$seconds = (int) apply_filters( 'openstation_electron_ttl', OPENSTATION_ELECTRON_TTL );

	return max( 2 * openstation_electron_interval(), $seconds );
}

/**
 * Human-readable name for a host platform.
 *
 * Mirrors `osLabelFor()` in the app's `lib/protocol.js`. Both sides
 * need it: the app to label its menus before any handshake, the server
 * so a stored record is self-describing to a plugin that has never
 * heard of Electron's platform strings.
 *
 * @param string $platform Normalized `process.platform` value.
 * @return string Display name.
 */
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

/**
 * Read the user's host record.
 *
 * Expiry is evaluated here rather than by a scheduled job: a record
 * whose last beat is older than the TTL reads as disconnected, and the
 * stale row is left alone for the next handshake to overwrite.
 *
 * @param int $user_id User ID. Falls back to the current user when 0.
 * @return array{
 *     connected: bool,
 *     hostId: string,
 *     platform: string,
 *     osLabel: string,
 *     appVersion: string,
 *     protocol: int,
 *     lastSeen: int,
 *     connectedAt: int
 * } Every key always present; `connected` is false when nothing is attached.
 */
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
	);
}

/**
 * Write (or refresh) the user's host record.
 *
 * @param int   $user_id User ID.
 * @param array $args    {
 *     Host description. Everything optional except `hostId`.
 *
 *     @type string $hostId     Stable per-installation id generated by the app.
 *     @type string $platform   'darwin' | 'win32' | 'linux' | …
 *     @type string $appVersion Host app version.
 *     @type int    $protocol   Host protocol version.
 * }
 * @return array The record as `openstation_electron_get_host()` would return it,
 *               or the empty record when the write was rejected.
 */
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
		'lastSeen'    => $now,
		// A reconnect from the same installation keeps its original
		// connection timestamp, so "how long has this desktop been
		// attached" survives a shell reload.
		'connectedAt' => ( is_array( $existing ) && ! empty( $existing['connectedAt'] ) && ! empty( $existing['hostId'] ) && $existing['hostId'] === $host_id )
			? (int) $existing['connectedAt']
			: $now,
	);

	update_user_meta( $user_id, OPENSTATION_ELECTRON_HOST_META, $record );

	return openstation_electron_get_host( $user_id );
}

/**
 * Drop the user's host record.
 *
 * @param int $user_id User ID.
 * @return bool True when a record was removed.
 */
function openstation_electron_clear_host( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	return (bool) delete_user_meta( $user_id, OPENSTATION_ELECTRON_HOST_META );
}

/**
 * The config blob handed to the adapter's shell bundle.
 *
 * @return array Config.
 */
function openstation_electron_config() {
	$user_id = get_current_user_id();

	$config = array(
		'enabled'   => openstation_electron_enabled( $user_id ),
		'restUrl'   => esc_url_raw( rest_url( OPENSTATION_ELECTRON_REST_NS . '/host' ) ),
		'restRoot'  => esc_url_raw( rest_url() ),
		'namespace' => OPENSTATION_ELECTRON_REST_NS,
		'interval'  => openstation_electron_interval() * 1000,
		'protocol'  => OPENSTATION_ELECTRON_PROTOCOL,
		'soloParam' => defined( 'OPENSTATION_SOLO_FLAG' ) ? OPENSTATION_SOLO_FLAG : 'openstation_solo',
		'last'      => openstation_electron_get_host( $user_id ),
	);

	/**
	 * Filter the adapter's shell config blob.
	 *
	 * @param array $config  Config.
	 * @param int   $user_id Current user.
	 */
	return (array) apply_filters( 'openstation_electron_config', $config, $user_id );
}

/**
 * Permission gate for every route below.
 *
 * Mirrors core's `openstation_rest_require_enabled` when it exists —
 * logged in AND OpenStation on — and falls back to a logged-in check
 * if core ever renames it, which fails closed on the part that
 * matters.
 *
 * @return bool|WP_Error True when allowed.
 */
function openstation_electron_rest_permission() {
	if ( function_exists( 'openstation_rest_require_enabled' ) ) {
		return openstation_rest_require_enabled();
	}
	return is_user_logged_in();
}

/**
 * Register the host routes.
 */
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

/**
 * REST handler — `GET /host`.
 *
 * @return WP_REST_Response Current record plus the interval a host should use.
 */
function openstation_electron_rest_get_host() {
	return rest_ensure_response(
		array_merge(
			openstation_electron_get_host( get_current_user_id() ),
			array(
				'heartbeatInterval' => openstation_electron_interval() * 1000,
				'protocol'          => OPENSTATION_ELECTRON_PROTOCOL,
			)
		)
	);
}

/**
 * REST handler — `POST /host/handshake`.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
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
		// The app speaks a newer dialect than this plugin version. Say
		// so plainly rather than half-accepting a payload we may be
		// mis-reading; the app degrades to "no server record" and every
		// client-side feature keeps working.
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
		)
	);

	if ( empty( $record['connected'] ) ) {
		return new WP_Error(
			'openstation_electron_invalid',
			__( 'The host identifier was missing or unusable.', 'openstation-electron-adapter' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * Fires when a native desktop host attaches to this site.
	 *
	 * @param array $record  Normalized host record.
	 * @param int   $user_id The user the host is attached to.
	 */
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

/**
 * REST handler — `POST /host/heartbeat`.
 *
 * The cheapest route here, and intentionally so: it touches one
 * user-meta row and answers with the interval. A host that beats
 * without ever having handshaked (the plugin was reactivated under it,
 * say) is upgraded to a full record rather than rejected — refusing
 * would make the app re-handshake, which costs strictly more.
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response|WP_Error
 */
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

	/**
	 * Fires on every desktop-host liveness beat.
	 *
	 * Runs as often as the interval allows — keep listeners cheap.
	 *
	 * @param array $record  Normalized host record.
	 * @param int   $user_id The user the host is attached to.
	 */
	do_action( 'openstation_electron_host_heartbeat', $record, $user_id );

	return rest_ensure_response(
		array_merge(
			$record,
			array( 'heartbeatInterval' => openstation_electron_interval() * 1000 )
		)
	);
}

/**
 * REST handler — `DELETE /host` and `POST /host/disconnect`.
 *
 * Both spellings exist because the two callers are different animals:
 * the shell speaks REST verbs, and the app's main process sends its
 * farewell through the same tiny POST helper it uses for everything
 * else, on a code path that runs while the app is quitting and must
 * not grow a second request shape.
 *
 * @return WP_REST_Response
 */
function openstation_electron_rest_disconnect() {
	$user_id = get_current_user_id();
	$record  = openstation_electron_get_host( $user_id );

	openstation_electron_clear_host( $user_id );

	if ( ! empty( $record['connected'] ) ) {
		/**
		 * Fires when a native desktop host detaches.
		 *
		 * @param array $record  The record as it was before removal.
		 * @param int   $user_id The user the host was attached to.
		 */
		do_action( 'openstation_electron_host_disconnected', $record, $user_id );
	}

	return rest_ensure_response( openstation_electron_get_host( $user_id ) );
}
