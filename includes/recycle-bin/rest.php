<?php

defined( 'ABSPATH' ) || exit;

function openstation_recycle_bin_register_rest_routes() {
	$namespace = 'desktop-mode/v1';

	register_rest_route(
		$namespace,
		'/recycle-bin',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_recycle_bin_rest_permission',
			'callback'            => 'openstation_recycle_bin_rest_list',
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
			'permission_callback' => 'openstation_recycle_bin_rest_permission',
			'callback'            => 'openstation_recycle_bin_rest_restore',

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
			'permission_callback' => 'openstation_recycle_bin_rest_permission',
			'callback'            => 'openstation_recycle_bin_rest_purge',
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
			'permission_callback' => 'openstation_recycle_bin_rest_permission',
			'callback'            => 'openstation_recycle_bin_rest_empty',
		)
	);

	register_rest_route(
		$namespace,
		'/recycle-bin/count',
		array(
			'methods'             => WP_REST_Server::READABLE,
			'permission_callback' => 'openstation_recycle_bin_rest_permission',
			'callback'            => static function () {
				return rest_ensure_response(
					array( 'count' => openstation_recycle_bin_count() )
				);
			},
		)
	);
}
add_action( 'rest_api_init', 'openstation_recycle_bin_register_rest_routes' );

function openstation_recycle_bin_rest_permission() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Sorry, you must be logged in.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}
	if ( function_exists( 'openstation_is_enabled' ) && ! openstation_is_enabled() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'OpenStation is not enabled for this user.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}
	return true;
}

function openstation_recycle_bin_rest_list( $request ) {
	$payload = openstation_recycle_bin_get_items(
		array(
			'page'     => (int) $request->get_param( 'page' ),
			'per_page' => (int) $request->get_param( 'per_page' ),
			'type'     => (string) $request->get_param( 'type' ),
			'search'   => (string) $request->get_param( 'search' ),
		)
	);

	return rest_ensure_response( $payload );
}

function openstation_recycle_bin_rest_restore( $request ) {
	$items = openstation_recycle_bin_normalize_items( $request );
	return rest_ensure_response( openstation_recycle_bin_apply_bulk( $items, 'openstation_recycle_bin_restore' ) );
}

function openstation_recycle_bin_rest_purge( $request ) {
	$items = openstation_recycle_bin_normalize_items( $request );
	return rest_ensure_response( openstation_recycle_bin_apply_bulk( $items, 'openstation_recycle_bin_purge' ) );
}

function openstation_recycle_bin_normalize_items( $request ) {
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

function openstation_recycle_bin_rest_empty() {
	return rest_ensure_response( openstation_recycle_bin_empty() );
}

function openstation_recycle_bin_apply_bulk( $items, $callback ) {
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
