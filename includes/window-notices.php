<?php

defined( 'ABSPATH' ) || exit;

function openstation_window_notice_tones() {
	return array( 'info', 'success', 'warning', 'error', 'danger', 'neutral' );
}

function openstation_register_window_notice( $args = array() ) {
	$defaults = array(
		'id'          => '',
		'message'     => '',
		'tone'        => 'info',
		'dismissible' => true,
		'icon'        => '',
		'match'       => array(),
		'order'       => 100,
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Window notice registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}
	if ( ! preg_match( '/^[a-z0-9_\\/-]+$/i', $id ) ) {
		return openstation_registration_error(
			'openstation_invalid_id',
			__( 'Window notice `id` must be alphanumeric with hyphens, underscores, or slashes.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	if ( '' === (string) $args['message'] ) {
		return openstation_registration_error(
			'openstation_missing_message',
			__( 'Window notice registration requires a non-empty `message`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$tone = (string) $args['tone'];
	if ( ! in_array( $tone, openstation_window_notice_tones(), true ) ) {
		return openstation_registration_error(
			'openstation_invalid_tone',
			__( 'Window notice `tone` must be one of the documented values.', 'desktop-mode' ),
			array(
				'id'   => $id,
				'tone' => $tone,
			)
		);
	}

	$icon_raw = (string) $args['icon'];
	$icon     = preg_match( '/^dashicons-[a-z0-9-]+$/', $icon_raw ) ? $icon_raw : '';

	$entry = array(
		'id'          => strtolower( $id ),
		'message'     => wp_kses_post( (string) $args['message'] ),
		'tone'        => $tone,
		'dismissible' => (bool) $args['dismissible'],
		'icon'        => $icon,
		'match'       => is_array( $args['match'] ) ? $args['match'] : array(),
		'order'       => (int) $args['order'],
	);

	openstation_window_notice_registry( $entry['id'], $entry );

	do_action( 'openstation_window_notice_registered', $entry['id'], $entry );

	return true;
}

function openstation_window_notice_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '__flush__' === (string) $id ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

function openstation_flush_window_notice_registry() {
	openstation_window_notice_registry( '__flush__' );
}

function openstation_build_window_notices_payload() {
	$registry = openstation_window_notice_registry();
	$entries  = is_array( $registry ) ? array_values( $registry ) : array();

	$entries = apply_filters( 'openstation_window_notices', $entries );

	usort(
		$entries,
		static function ( $a, $b ) {
			$oa = isset( $a['order'] ) ? (int) $a['order'] : 100;
			$ob = isset( $b['order'] ) ? (int) $b['order'] : 100;
			if ( $oa !== $ob ) {
				return $oa - $ob;
			}
			return strcmp( (string) $a['id'], (string) $b['id'] );
		}
	);

	return $entries;
}
