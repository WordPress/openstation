<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_SEEN_INTROS_META_KEY = 'desktop_mode_seen_intros';

const OPENSTATION_SEEN_INTROS_MAX = 64;

function openstation_get_seen_intros( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return array();
	}

	$raw = get_user_meta( $user_id, OPENSTATION_SEEN_INTROS_META_KEY, true );
	if ( ! is_array( $raw ) ) {
		return array();
	}

	return openstation_sanitize_seen_intros( $raw );
}

function openstation_has_seen_intro( $user_id, $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return false;
	}
	return in_array( $slug, openstation_get_seen_intros( $user_id ), true );
}

function openstation_mark_intro_seen( $user_id, $slug ) {
	$user_id = (int) $user_id;
	$slug    = sanitize_key( (string) $slug );
	if ( $user_id <= 0 || '' === $slug ) {
		return false;
	}

	$current = openstation_get_seen_intros( $user_id );
	$kept    = array_values( array_diff( $current, openstation_seen_intros_superseded_by( $slug ) ) );
	if ( in_array( $slug, $kept, true ) && count( $kept ) === count( $current ) ) {
		return true;
	}

	if ( ! in_array( $slug, $kept, true ) ) {
		$kept[] = $slug;
	}
	$kept = array_slice( $kept, 0, OPENSTATION_SEEN_INTROS_MAX );

	return false !== update_user_meta(
		$user_id,
		OPENSTATION_SEEN_INTROS_META_KEY,
		$kept
	);
}

function openstation_seen_intros_superseded_by( $slug ) {
	$pairs = array(
		'shell-tour-skipped' => array( 'shell-tour-done' ),
		'shell-tour-done'    => array( 'shell-tour-skipped' ),
	);
	return isset( $pairs[ $slug ] ) ? $pairs[ $slug ] : array();
}

function openstation_clear_seen_intros( $user_id ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		return false;
	}
	return (bool) delete_user_meta( $user_id, OPENSTATION_SEEN_INTROS_META_KEY );
}

function openstation_sanitize_seen_intros( $raw ) {
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$out = array();
	foreach ( $raw as $entry ) {
		if ( ! is_string( $entry ) ) {
			continue;
		}
		$slug = sanitize_key( $entry );
		if ( '' === $slug ) {
			continue;
		}
		$out[] = $slug;
	}
	return array_slice( array_values( array_unique( $out ) ), 0, OPENSTATION_SEEN_INTROS_MAX );
}

function openstation_register_seen_intros_routes() {
	register_rest_route(
		'desktop-mode/v1',
		'/intros/seen',
		array(
			'methods'             => WP_REST_Server::CREATABLE,
			'callback'            => 'openstation_rest_mark_intro_seen',
			'permission_callback' => 'openstation_rest_seen_intros_permission',
			'args'                => array(
				'slug' => array(
					'required' => true,
					'type'     => 'string',
				),
			),
		)
	);

	register_rest_route(
		'desktop-mode/v1',
		'/intros',
		array(
			'methods'             => WP_REST_Server::DELETABLE,
			'callback'            => 'openstation_rest_clear_seen_intros',
			'permission_callback' => 'openstation_rest_seen_intros_permission',
		)
	);
}
add_action( 'rest_api_init', 'openstation_register_seen_intros_routes' );

function openstation_seen_intros_classic_admin_slugs() {
	$slugs = array();
	if ( defined( 'OPENSTATION_WELCOME_INTRO_SLUG' ) ) {
		$slugs[] = OPENSTATION_WELCOME_INTRO_SLUG;
	}
	if ( defined( 'OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG' ) ) {
		$slugs[] = OPENSTATION_ACTIVATION_NUDGE_INTRO_SLUG;
	}
	return $slugs;
}

function openstation_rest_seen_intros_permission( WP_REST_Request $request ) {
	$slug = sanitize_key( (string) $request->get_param( 'slug' ) );
	if ( '' !== $slug && in_array( $slug, openstation_seen_intros_classic_admin_slugs(), true ) ) {
		if ( ! is_user_logged_in() ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'Authentication required.', 'desktop-mode' ),
				array( 'status' => 401 )
			);
		}
		if ( ! current_user_can( 'read' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You are not allowed to do that.', 'desktop-mode' ),
				array( 'status' => 403 )
			);
		}
		return true;
	}

	return openstation_rest_require_enabled();
}

function openstation_rest_mark_intro_seen( WP_REST_Request $request ) {
	$user_id = get_current_user_id();
	$slug    = sanitize_key( (string) $request->get_param( 'slug' ) );
	if ( '' === $slug ) {
		return new WP_Error(
			'openstation_invalid_intro_slug',
			__( 'The `slug` parameter must be a non-empty string.', 'desktop-mode' ),
			array( 'status' => 400 )
		);
	}
	openstation_mark_intro_seen( $user_id, $slug );
	return rest_ensure_response(
		array( 'seenIntros' => openstation_get_seen_intros( $user_id ) )
	);
}

function openstation_rest_clear_seen_intros() {
	$user_id = get_current_user_id();
	openstation_clear_seen_intros( $user_id );
	return rest_ensure_response(
		array( 'seenIntros' => openstation_get_seen_intros( $user_id ) )
	);
}
