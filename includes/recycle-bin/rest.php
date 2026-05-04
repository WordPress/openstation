<?php
/**
 * Desktop Mode — Recycle Bin: REST routes.
 *
 * Three routes, all under `/desktop-mode/v1/recycle-bin`:
 *
 *   GET    /                  — list trashed items
 *   POST   /restore           — body { ids: int[] }
 *   POST   /purge             — body { ids: int[] }
 *   POST   /empty             — empties the visible bin
 *
 * Permission gating delegates to `desktop_mode_recycle_bin_user_can_*` per item;
 * the route-level callback only checks "are you logged in and in
 * desktop mode at all?" via `desktop_mode_is_enabled()`.
 *
 * @package WPDesktopMode
 * @since   0.19.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register REST routes.
 *
 * @since 0.19.0
 */
function desktop_mode_recycle_bin_register_rest_routes() {
	$namespace = 'desktop-mode/v1';

	register_rest_route(
		$namespace,
		'/recycle-bin',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_recycle_bin_rest_permission',
			'callback'            => 'desktop_mode_recycle_bin_rest_list',
			'args'                => array(
				'page'     => array(
					'type'              => 'integer',
					'default'           => 1,
					'sanitize_callback' => 'absint',
				),
				'per_page' => array(
					'type'              => 'integer',
					'default'           => 100,
					'sanitize_callback' => 'absint',
				),
				'type'     => array(
					'type'              => 'string',
					'default'           => '',
					'sanitize_callback' => 'sanitize_key',
				),
				'search'   => array(
					'type'              => 'string',
					'default'           => '',
					'sanitize_callback' => 'sanitize_text_field',
				),
			),
		)
	);

	register_rest_route(
		$namespace,
		'/recycle-bin/restore',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_recycle_bin_rest_permission',
			'callback'            => 'desktop_mode_recycle_bin_rest_restore',
			// Accepts either `items: [{id, type}]` (preferred) or
			// `ids: int[]` (legacy — assumes post-ish entities).
			// Both registered as optional; the handler validates.
			'args'                => array(
				'items' => array(
					'type'     => 'array',
					'required' => false,
				),
				'ids'   => array(
					'type'     => 'array',
					'required' => false,
					'items'    => array( 'type' => 'integer' ),
				),
			),
		)
	);

	register_rest_route(
		$namespace,
		'/recycle-bin/purge',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_recycle_bin_rest_permission',
			'callback'            => 'desktop_mode_recycle_bin_rest_purge',
			'args'                => array(
				'items' => array(
					'type'     => 'array',
					'required' => false,
				),
				'ids'   => array(
					'type'     => 'array',
					'required' => false,
					'items'    => array( 'type' => 'integer' ),
				),
			),
		)
	);

	register_rest_route(
		$namespace,
		'/recycle-bin/empty',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'permission_callback' => 'desktop_mode_recycle_bin_rest_permission',
			'callback'            => 'desktop_mode_recycle_bin_rest_empty',
		)
	);

	register_rest_route(
		$namespace,
		'/recycle-bin/count',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'desktop_mode_recycle_bin_rest_permission',
			'callback'            => static function () {
				return rest_ensure_response(
					array( 'count' => desktop_mode_recycle_bin_count() )
				);
			},
		)
	);
}
add_action( 'rest_api_init', 'desktop_mode_recycle_bin_register_rest_routes' );

/**
 * Route-level permission gate.
 *
 * Per-item capability checks happen inside the store layer; here we
 * only enforce "logged-in user with desktop mode opted in" — same
 * baseline as every other desktop REST surface.
 *
 * @since 0.19.0
 *
 * @return bool|WP_Error
 */
function desktop_mode_recycle_bin_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Sorry, you must be logged in.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Desktop mode is not enabled for this user.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

/**
 * GET /recycle-bin
 *
 * @since 0.19.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function desktop_mode_recycle_bin_rest_list( $request ) {
	$payload = desktop_mode_recycle_bin_get_items(
		array(
			'page'     => (int) $request->get_param( 'page' ),
			'per_page' => (int) $request->get_param( 'per_page' ),
			'type'     => (string) $request->get_param( 'type' ),
			'search'   => (string) $request->get_param( 'search' ),
		)
	);

	return rest_ensure_response( $payload );
}

/**
 * POST /recycle-bin/restore
 *
 * @since 0.19.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function desktop_mode_recycle_bin_rest_restore( $request ) {
	$items = desktop_mode_recycle_bin_normalize_items( $request );
	return rest_ensure_response( desktop_mode_recycle_bin_apply_bulk( $items, 'desktop_mode_recycle_bin_restore' ) );
}

/**
 * POST /recycle-bin/purge
 *
 * @since 0.19.0
 *
 * @param WP_REST_Request $request REST request.
 * @return WP_REST_Response
 */
function desktop_mode_recycle_bin_rest_purge( $request ) {
	$items = desktop_mode_recycle_bin_normalize_items( $request );
	return rest_ensure_response( desktop_mode_recycle_bin_apply_bulk( $items, 'desktop_mode_recycle_bin_purge' ) );
}

/**
 * Read either `items: [{id, type}]` (preferred) or `ids: int[]`
 * (legacy) and normalise into a list of `[id, type]` pairs the
 * bulk runner can hand straight to a typed callback.
 *
 * @since 0.21.0
 *
 * @param WP_REST_Request $request REST request.
 * @return array<int, array{id:int, type:string}>
 */
function desktop_mode_recycle_bin_normalize_items( $request ) {
	$out = array();

	$items = $request->get_param( 'items' );
	if ( is_array( $items ) ) {
		foreach ( $items as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			$id   = isset( $entry['id'] ) ? (int) $entry['id'] : 0;
			$type = isset( $entry['type'] ) ? sanitize_key( (string) $entry['type'] ) : '';
			if ( $id <= 0 ) {
				continue;
			}
			$out[] = array(
				'id'   => $id,
				'type' => $type,
			);
		}
		return $out;
	}

	$ids = $request->get_param( 'ids' );
	if ( is_array( $ids ) ) {
		foreach ( $ids as $id ) {
			$id = (int) $id;
			if ( $id > 0 ) {
				$out[] = array(
					'id'   => $id,
					'type' => '',
				);
			}
		}
	}
	return $out;
}

/**
 * POST /recycle-bin/empty
 *
 * @since 0.19.0
 *
 * @return WP_REST_Response
 */
function desktop_mode_recycle_bin_rest_empty() {
	return rest_ensure_response( desktop_mode_recycle_bin_empty() );
}

/**
 * Run a per-item callback over a list, capturing per-item results.
 *
 * @since 0.19.0
 * @since 0.21.0 `$items` now carries `{id, type}` pairs; the
 *               callback receives both arguments. Legacy id-only
 *               callers go through `desktop_mode_recycle_bin_normalize_items`,
 *               which fills `type` with `''` (post default).
 *
 * @param array<int, array{id:int, type:string}> $items    Items to operate on.
 * @param callable                               $callback `($id, $type) → true|WP_Error`.
 * @return array{ok:int[], errors:array<int, array{id:int, code:string, message:string}>}
 */
function desktop_mode_recycle_bin_apply_bulk( $items, $callback ) {
	$ok     = array();
	$errors = array();

	foreach ( $items as $item ) {
		$id   = isset( $item['id'] ) ? (int) $item['id'] : 0;
		$type = isset( $item['type'] ) ? (string) $item['type'] : '';
		if ( $id <= 0 ) {
			continue;
		}
		$result = call_user_func( $callback, $id, $type );
		if ( is_wp_error( $result ) ) {
			$errors[] = array(
				'id'      => $id,
				'code'    => $result->get_error_code(),
				'message' => $result->get_error_message(),
			);
		} else {
			$ok[] = $id;
		}
	}

	return array(
		'ok'     => $ok,
		'errors' => $errors,
	);
}
