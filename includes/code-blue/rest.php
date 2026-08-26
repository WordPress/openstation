<?php
/**
 * OpenStation — Code Blue: REST routes.
 *
 * Three endpoints under `desktop-mode/v1/code-blue`:
 *
 *   GET /sources
 *     Log sources this install offers, plus the environment card
 *     (debug constants, PHP/WP versions, environment type).
 *
 *   GET /entries?source=<id>
 *     Parsed entries from one source's trailing window:
 *     `{ source, entries, truncated, scanned_bytes,
 *        dropped_entries, generated_at }`.
 *
 *   DELETE /entries?source=<id>
 *     Truncates the source's file to zero bytes.
 *
 * Every route sits behind `openstation_code_blue_user_can_use()`
 * (manage_options by default) — log content leaks server paths and
 * SQL, so this is deliberately an administrators-only surface.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Capability check shared across every endpoint.
 *
 * @return bool
 */
function openstation_code_blue_rest_permission() {
	return openstation_code_blue_user_can_use();
}

/**
 * Register the routes.
 */
function openstation_code_blue_register_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/code-blue/sources',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'callback'            => 'openstation_code_blue_rest_sources',
			'permission_callback' => 'openstation_code_blue_rest_permission',
		)
	);
	register_rest_route(
		'desktop-mode/v1',
		'/code-blue/entries',
		array(
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => 'openstation_code_blue_rest_entries',
				'permission_callback' => 'openstation_code_blue_rest_permission',
				'args'                => array(
					'source' => array(
						'description' => 'Log source id from GET /sources.',
						'type'        => 'string',
						'required'    => true,
					),
				),
			),
			array(
				'methods'             => WP_REST_Server::DELETABLE,
				'callback'            => 'openstation_code_blue_rest_clear',
				'permission_callback' => 'openstation_code_blue_rest_permission',
				'args'                => array(
					'source' => array(
						'description' => 'Log source id from GET /sources.',
						'type'        => 'string',
						'required'    => true,
					),
				),
			),
		)
	);
}
add_action( 'rest_api_init', 'openstation_code_blue_register_routes' );

/**
 * The environment card: the switches and versions an error hunter
 * checks first, as `{ key, label, value, on }` rows. `on` is null
 * for rows that are informational rather than toggles.
 *
 * @return array[]
 */
function openstation_code_blue_environment() {
	$rows = array();
	foreach ( array( 'WP_DEBUG', 'WP_DEBUG_LOG', 'WP_DEBUG_DISPLAY', 'SCRIPT_DEBUG', 'SAVEQUERIES' ) as $constant ) {
		$on     = defined( $constant ) && constant( $constant );
		$rows[] = array(
			'key'   => strtolower( $constant ),
			'label' => $constant,
			'value' => $on ? 'on' : 'off',
			'on'    => $on,
		);
	}

	$rows = array_merge(
		$rows,
		array(
			array(
				'key'   => 'environment',
				'label' => __( 'Environment', 'desktop-mode' ),
				'value' => wp_get_environment_type(),
				'on'    => null,
			),
			array(
				'key'   => 'php',
				'label' => 'PHP',
				'value' => PHP_VERSION,
				'on'    => null,
			),
			array(
				'key'   => 'wordpress',
				'label' => 'WordPress',
				'value' => get_bloginfo( 'version' ),
				'on'    => null,
			),
		)
	);

	/**
	 * Filter the environment rows shown in the Code Blue window.
	 *
	 * @param array[] $rows Each: `key`, `label`, `value` (string),
	 *                      `on` (bool|null — null renders neutral).
	 */
	return (array) apply_filters( 'openstation_code_blue_environment', $rows );
}

/**
 * GET /sources
 *
 * @return WP_REST_Response
 */
function openstation_code_blue_rest_sources() {
	return rest_ensure_response(
		array(
			'sources'     => openstation_code_blue_log_sources(),
			'environment' => openstation_code_blue_environment(),
		)
	);
}

/**
 * Resolve the `source` param to a readable descriptor or an error.
 *
 * @param WP_REST_Request $request Request.
 * @return array|WP_Error
 */
function openstation_code_blue_rest_resolve_source( WP_REST_Request $request ) {
	$id     = sanitize_key( (string) $request->get_param( 'source' ) );
	$source = openstation_code_blue_get_source( $id );
	if ( null === $source ) {
		return new WP_Error(
			'openstation_code_blue_unknown_source',
			__( 'Unknown log source.', 'desktop-mode' ),
			array( 'status' => 404 )
		);
	}
	return $source;
}

/**
 * GET /entries?source=<id>
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_code_blue_rest_entries( WP_REST_Request $request ) {
	$source = openstation_code_blue_rest_resolve_source( $request );
	if ( is_wp_error( $source ) ) {
		return $source;
	}

	// A registered source whose file doesn't exist yet (debug log
	// before the first error is written) is an EMPTY log, not an
	// error condition.
	if ( ! $source['exists'] ) {
		return rest_ensure_response(
			array(
				'source'          => $source,
				'entries'         => array(),
				'truncated'       => false,
				'scanned_bytes'   => 0,
				'dropped_entries' => 0,
				'generated_at'    => time(),
			)
		);
	}
	if ( ! $source['readable'] ) {
		return new WP_Error(
			'openstation_code_blue_unreadable',
			__( 'The log file exists but PHP cannot read it.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	$read = openstation_code_blue_read_source( $source );

	return rest_ensure_response(
		array(
			'source'          => $source,
			'entries'         => $read['entries'],
			'truncated'       => $read['truncated'],
			'scanned_bytes'   => $read['scanned_bytes'],
			'dropped_entries' => $read['dropped_entries'],
			'generated_at'    => time(),
		)
	);
}

/**
 * DELETE /entries?source=<id> — truncate the log file.
 *
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response|WP_Error
 */
function openstation_code_blue_rest_clear( WP_REST_Request $request ) {
	$source = openstation_code_blue_rest_resolve_source( $request );
	if ( is_wp_error( $source ) ) {
		return $source;
	}

	// Clearing a log whose file doesn't exist is a no-op success.
	if ( ! $source['exists'] ) {
		return rest_ensure_response( array( 'cleared' => true ) );
	}
	if ( ! $source['writable'] ) {
		return new WP_Error(
			'openstation_code_blue_unwritable',
			__( 'The log file is not writable, so it cannot be cleared.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Truncating a server-side log the descriptor already validated; WP_Filesystem adds nothing here.
	$written = file_put_contents( $source['path'], '' );
	if ( false === $written ) {
		return new WP_Error(
			'openstation_code_blue_clear_failed',
			__( 'Clearing the log file failed.', 'desktop-mode' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Fires after the Code Blue window truncates a log file.
	 *
	 * @param string $id   Source id.
	 * @param string $path Absolute file path that was truncated.
	 */
	do_action( 'openstation_code_blue_log_cleared', $source['id'], $source['path'] );

	// Just the flag — the client refreshes its picker from
	// GET /sources after a clear, so a descriptor here would be
	// dead weight built by a second discovery pass.
	return rest_ensure_response( array( 'cleared' => true ) );
}
