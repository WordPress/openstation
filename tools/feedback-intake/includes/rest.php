<?php
/**
 * The intake route and the read route.
 *
 *   POST /openstation-feedback/v1/deactivation   public, throttled
 *   GET  /openstation-feedback/v1/deactivation   manage_options
 *
 * The POST is reachable by anyone on the internet, by design: the
 * senders are anonymous WordPress sites. What keeps it cheap under
 * abuse, in the order the checks run:
 *
 *   1. A gate on `rest_pre_dispatch`, which Core runs before it
 *      matches the route, parses the body or validates anything.
 *      (A permission callback would be too late: Core validates the
 *      schema first and only then asks for permission.) The gate
 *      bails on anything but a small JSON body: wrong content type,
 *      no body, or more than OSFI_MAX_BODY_BYTES.
 *   2. Two throttles in the same gate, both counters in transients
 *      (the object cache when the host has one): per client IP, and
 *      one global ceiling so a distributed flood cannot turn the
 *      database into the bottleneck. Over either limit answers 429
 *      with Retry-After. The IP is hashed with a site salt for the
 *      transient key and is never stored anywhere else.
 *   3. Still in the gate: an unknown key in the JSON is a 400. Core
 *      validates the keys it knows and lets the rest through, so the
 *      closed key set has to be enforced by hand.
 *   4. Core's schema validation: every key typed, enums closed,
 *      lengths capped.
 *   5. One INSERT IGNORE keyed on the submission id, so a retry is a
 *      no-op rather than a second row.
 *
 * Nothing here logs the request, and the answers carry nothing an
 * attacker could use to probe (no row counts, no timing hints).
 *
 * @package OpenStationFeedbackIntake
 */

defined( 'ABSPATH' ) || exit;

const OSFI_NAMESPACE = 'openstation-feedback/v1';

/** Largest request body accepted, in bytes. A real submission is about 500. */
const OSFI_MAX_BODY_BYTES = 2048;

/** Per-IP: this many submissions per window. */
const OSFI_RATE_PER_IP = 5;

/** Global: this many submissions per window, all senders together. */
const OSFI_RATE_GLOBAL = 300;

/** Throttle window, in seconds. */
const OSFI_RATE_WINDOW = 60;

/** The reasons the dialog offers, mirrored from the plugin. */
const OSFI_REASONS = array( 'changed_too_much', 'missing_features', 'too_buggy', 'other' );

/** Where the dialog was shown. */
const OSFI_CONTEXTS = array( 'classic', 'chromeless', 'app' );

/** Longest free text kept, in characters. */
const OSFI_DETAILS_MAX = 1000;

/**
 * Register both routes.
 */
function osfi_register_routes() {
	register_rest_route(
		OSFI_NAMESPACE,
		'/deactivation',
		array(
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => 'osfi_rest_receive',
				// Public by design; the abuse checks run earlier, in
				// osfi_gate() on rest_pre_dispatch.
				'permission_callback' => '__return_true',
				'args'                => osfi_submission_schema(),
			),
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'osfi_rest_list',
				'permission_callback' => 'osfi_rest_list_permission',
				'args'                => array(
					'after'    => array(
						'type'        => 'string',
						'format'      => 'date-time',
						'description' => 'Only rows received at or after this moment (ISO 8601).',
					),
					'per_page' => array(
						'type'    => 'integer',
						'minimum' => 1,
						'maximum' => 1000,
						'default' => 200,
					),
					'page'     => array(
						'type'    => 'integer',
						'minimum' => 1,
						'default' => 1,
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'osfi_register_routes' );

/**
 * The submission schema: exactly the keys the plugin sends, each
 * typed and bounded. The closed key set is enforced in osfi_gate()
 * (Core validates `args` per key and lets unknown keys through), so
 * an unexpected key is a 400, not a drop.
 *
 * @return array
 */
function osfi_submission_schema() {
	$bool = array(
		'type'     => 'boolean',
		'required' => true,
	);
	$int  = array(
		'type'     => 'integer',
		'required' => true,
		'minimum'  => 0,
		'maximum'  => 100000,
	);
	// The two ages are `null` on a site without the install stamps.
	// Not `required`: Core reads a JSON null as a missing parameter.
	$age  = array(
		'type'    => array( 'integer', 'null' ),
		'default' => null,
		'minimum' => 0,
		'maximum' => 100000,
	);
	$str  = array(
		'type'      => 'string',
		'required'  => true,
		'maxLength' => 32,
		'pattern'   => '^[A-Za-z0-9._-]*$',
	);
	return array(
		'id'                      => array(
			'type'     => 'string',
			'required' => true,
			'pattern'  => '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
		),
		'reasons'                 => array(
			'type'        => 'array',
			'required'    => true,
			'minItems'    => 1,
			'maxItems'    => count( OSFI_REASONS ),
			'uniqueItems' => true,
			'items'       => array(
				'type' => 'string',
				'enum' => OSFI_REASONS,
			),
		),
		'details'                 => array(
			'type'      => 'string',
			'required'  => true,
			'maxLength' => OSFI_DETAILS_MAX,
		),
		'plugin_version'          => $str,
		'wp_version'              => $str,
		'php_version'             => $str,
		'locale'                  => $str,
		'multisite'               => $bool,
		'install_age_days'        => $age,
		'ever_enabled'            => $bool,
		'enabled_user_count'      => $int,
		'first_enable_delay_days' => $age,
		'deactivator_enabled'     => $bool,
		'active_plugins'          => $int,
		'context'                 => array(
			'type'     => 'string',
			'required' => true,
			'enum'     => OSFI_CONTEXTS,
		),
	);
}

/**
 * The sender's IP, from the connection only. `X-Forwarded-For` is
 * spoofable and the host's proxy already rewrites REMOTE_ADDR to the
 * real client. Filterable for a host where that is not the case.
 *
 * @return string
 */
function osfi_client_ip() {
	$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	/**
	 * Filters the client IP used for the throttle key.
	 *
	 * @param string $ip
	 */
	return (string) apply_filters( 'osfi_client_ip', $ip );
}

/**
 * Bump a windowed counter and say whether it is over its limit.
 *
 * Fixed windows in transients: simple, one read and one write, and
 * honest enough at these limits. A miss creates the key with the
 * window as its expiry; a hit increments in place.
 *
 * @param string $key   Transient key.
 * @param int    $limit Allowed hits per window.
 * @return bool True when this hit is over the limit.
 */
function osfi_over_limit( $key, $limit ) {
	$count = (int) get_transient( $key );
	if ( $count >= $limit ) {
		return true;
	}
	if ( 0 === $count ) {
		set_transient( $key, 1, OSFI_RATE_WINDOW );
	} else {
		// Keep the window's original expiry: set_transient with a
		// fresh timeout would slide it on every hit.
		set_transient( $key, $count + 1, OSFI_RATE_WINDOW );
	}
	return false;
}

/**
 * The abuse gate, on `rest_pre_dispatch`: everything cheap and
 * abuse-facing, before Core matches, parses or validates anything.
 * Returns a response to short-circuit the request, or the incoming
 * `$result` to let it through.
 *
 * @param mixed           $result  Whatever an earlier filter decided.
 * @param WP_REST_Server  $server  Unused.
 * @param WP_REST_Request $request The request.
 * @return mixed
 */
function osfi_gate( $result, $server, $request ) {
	if ( null !== $result || 'POST' !== $request->get_method() || '/' . OSFI_NAMESPACE . '/deactivation' !== $request->get_route() ) {
		return $result;
	}

	$content_type = $request->get_content_type();
	if ( ! is_array( $content_type ) || 'application/json' !== $content_type['value'] ) {
		return osfi_reject( 'osfi_bad_content_type', 'Send JSON.', 415 );
	}

	$body = $request->get_body();
	if ( '' === $body || strlen( $body ) > OSFI_MAX_BODY_BYTES ) {
		return osfi_reject( 'osfi_bad_size', 'Body missing or too large.', 413 );
	}

	$ip = osfi_client_ip();
	if ( '' === $ip ) {
		return osfi_reject( 'osfi_no_client', 'No client address.', 400 );
	}

	if ( osfi_over_limit( 'osfi_rl_global', OSFI_RATE_GLOBAL )
		|| osfi_over_limit( 'osfi_rl_' . substr( hash_hmac( 'sha256', $ip, wp_salt( 'nonce' ) ), 0, 32 ), OSFI_RATE_PER_IP )
	) {
		return osfi_reject( 'osfi_throttled', 'Too many submissions. Try later.', 429, array( 'Retry-After' => (string) OSFI_RATE_WINDOW ) );
	}

	$json = $request->get_json_params();
	if ( ! is_array( $json ) ) {
		return osfi_reject( 'osfi_bad_json', 'Body is not a JSON object.', 400 );
	}
	$unknown = array_diff( array_keys( $json ), array_keys( osfi_submission_schema() ) );
	if ( ! empty( $unknown ) ) {
		return osfi_reject( 'osfi_unknown_key', 'Unknown key in submission.', 400 );
	}

	return $result;
}
add_filter( 'rest_pre_dispatch', 'osfi_gate', 10, 3 );

/**
 * A short-circuit response in Core's error shape.
 *
 * @param string $code
 * @param string $message
 * @param int    $status
 * @param array  $headers
 * @return WP_REST_Response
 */
function osfi_reject( $code, $message, $status, array $headers = array() ) {
	return new WP_REST_Response(
		array(
			'code'    => $code,
			'message' => $message,
			'data'    => array( 'status' => $status ),
		),
		$status,
		$headers
	);
}

/**
 * Bucket an exact count so the stored value cannot fingerprint a site.
 *
 * @param int|null $n
 * @param array    $edges Ascending upper bounds, e.g. [0, 1, 5].
 * @param string[] $labels One more label than edges.
 * @return string
 */
function osfi_bucket( $n, array $edges, array $labels ) {
	if ( null === $n ) {
		return '';
	}
	foreach ( $edges as $i => $edge ) {
		if ( $n <= $edge ) {
			return $labels[ $i ];
		}
	}
	return $labels[ count( $edges ) ];
}

/**
 * Handler for the POST: bucket, sanitise, insert once.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function osfi_rest_receive( WP_REST_Request $request ) {
	global $wpdb;

	$p = $request->get_params();

	// The dialog's order, deduplicated, which the schema already
	// guarantees; intersect keeps that order stable in storage.
	$reasons = array_values( array_intersect( OSFI_REASONS, (array) $p['reasons'] ) );

	$row = array(
		'id'                    => array( strtolower( (string) $p['id'] ), '%s' ),
		'received_at_ms'        => array( (int) round( microtime( true ) * 1000 ), '%d' ),
		'reasons'               => array( implode( ',', $reasons ), '%s' ),
		'details'               => array( mb_substr( sanitize_textarea_field( (string) $p['details'] ), 0, OSFI_DETAILS_MAX ), '%s' ),
		'plugin_version'        => array( sanitize_text_field( (string) $p['plugin_version'] ), '%s' ),
		'wp_version'            => array( sanitize_text_field( (string) $p['wp_version'] ), '%s' ),
		'php_version'           => array( sanitize_text_field( (string) $p['php_version'] ), '%s' ),
		'locale'                => array( sanitize_text_field( (string) $p['locale'] ), '%s' ),
		'multisite'             => array( (int) (bool) $p['multisite'], '%d' ),
		'ever_enabled'          => array( (int) (bool) $p['ever_enabled'], '%d' ),
		'deactivator_enabled'   => array( (int) (bool) $p['deactivator_enabled'], '%d' ),
		'enabled_user_bucket'   => array( osfi_bucket( $p['enabled_user_count'], array( 0, 1, 5 ), array( '0', '1', '2-5', '6+' ) ), '%s' ),
		'active_plugins_bucket' => array( osfi_bucket( $p['active_plugins'], array( 9, 29 ), array( '<10', '10-29', '30+' ) ), '%s' ),
		'context'               => array( (string) $p['context'], '%s' ),
	);
	// The two nullable ages are left out of the INSERT when unknown,
	// so the column stays NULL rather than 0.
	foreach ( array( 'install_age_days', 'first_enable_delay_days' ) as $nullable ) {
		if ( null !== $p[ $nullable ] ) {
			$row[ $nullable ] = array( (int) $p[ $nullable ], '%d' );
		}
	}

	$columns = implode( ', ', array_keys( $row ) );
	$holders = implode( ', ', array_column( $row, 1 ) );
	$values  = array_column( $row, 0 );

	// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- own table, one write; column names and placeholders are literals from this file.
	$inserted = $wpdb->query( $wpdb->prepare( 'INSERT IGNORE INTO ' . osfi_table() . " ({$columns}) VALUES ({$holders})", $values ) );

	// A duplicate id is a retry: fine, and not a second row.
	return new WP_REST_Response( array( 'received' => true ), $inserted ? 201 : 200 );
}

/**
 * Permission callback for the GET: site admins only, cookie or
 * application password.
 *
 * @return true|WP_Error
 */
function osfi_rest_list_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error( 'rest_forbidden', 'Authentication required.', array( 'status' => 401 ) );
	}
	if ( ! current_user_can( 'manage_options' ) ) {
		return new WP_Error( 'rest_forbidden', 'Not allowed.', array( 'status' => 403 ) );
	}
	return true;
}

/**
 * Read rows, newest first. Shared by the GET route and the CSV export.
 *
 * @param array $args { after?: int (ms), before?: int (ms), reason?: string, per_page: int, page: int }
 * @return array{ rows: array[], total: int }
 */
function osfi_query_rows( array $args ) {
	global $wpdb;
	$table = osfi_table();
	$where = array( '1=1' );
	$vals  = array();
	if ( ! empty( $args['after'] ) ) {
		$where[] = 'received_at_ms >= %d';
		$vals[]  = (int) $args['after'];
	}
	if ( ! empty( $args['before'] ) ) {
		$where[] = 'received_at_ms < %d';
		$vals[]  = (int) $args['before'];
	}
	if ( ! empty( $args['reason'] ) && in_array( $args['reason'], OSFI_REASONS, true ) ) {
		$where[] = 'FIND_IN_SET( %s, reasons ) > 0';
		$vals[]  = $args['reason'];
	}
	$per_page = max( 1, min( 1000, (int) ( $args['per_page'] ?? 200 ) ) );
	$offset   = ( max( 1, (int) ( $args['page'] ?? 1 ) ) - 1 ) * $per_page;
	$sql_where = implode( ' AND ', $where );

	// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.NotPrepared -- own table; the WHERE fragments are literals from this function.
	$total = (int) $wpdb->get_var( $vals ? $wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE {$sql_where}", $vals ) : "SELECT COUNT(*) FROM {$table} WHERE {$sql_where}" );
	$rows  = $wpdb->get_results(
		$wpdb->prepare( "SELECT * FROM {$table} WHERE {$sql_where} ORDER BY received_at_ms DESC LIMIT %d OFFSET %d", array_merge( $vals, array( $per_page, $offset ) ) ),
		ARRAY_A
	);
	// phpcs:enable

	foreach ( $rows as &$r ) {
		$r['reasons']                 = '' === $r['reasons'] ? array() : explode( ',', $r['reasons'] );
		$r['received_at']             = gmdate( 'c', (int) floor( (int) $r['received_at_ms'] / 1000 ) );
		$r['received_at_ms']          = (int) $r['received_at_ms'];
		$r['multisite']               = (bool) $r['multisite'];
		$r['ever_enabled']            = (bool) $r['ever_enabled'];
		$r['deactivator_enabled']     = (bool) $r['deactivator_enabled'];
		$r['install_age_days']        = null === $r['install_age_days'] ? null : (int) $r['install_age_days'];
		$r['first_enable_delay_days'] = null === $r['first_enable_delay_days'] ? null : (int) $r['first_enable_delay_days'];
	}
	unset( $r );

	return array(
		'rows'  => $rows,
		'total' => $total,
	);
}

/**
 * Handler for the GET: JSON rows for the metrics script.
 *
 * @param WP_REST_Request $request
 * @return WP_REST_Response
 */
function osfi_rest_list( WP_REST_Request $request ) {
	$after  = $request->get_param( 'after' );
	$result = osfi_query_rows(
		array(
			'after'    => $after ? strtotime( $after ) * 1000 : 0,
			'per_page' => (int) $request->get_param( 'per_page' ),
			'page'     => (int) $request->get_param( 'page' ),
		)
	);
	$response = new WP_REST_Response( $result['rows'] );
	$response->header( 'X-WP-Total', (string) $result['total'] );
	return $response;
}
