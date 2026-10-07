<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_SOLO_FLAG = 'openstation_solo';

function openstation_solo_window_id() {

	$raw = ( isset( $_GET[ OPENSTATION_SOLO_FLAG ] ) && is_scalar( $_GET[ OPENSTATION_SOLO_FLAG ] ) )
		? sanitize_text_field( wp_unslash( $_GET[ OPENSTATION_SOLO_FLAG ] ) )
		: '';
	if ( '' === $raw ) {
		return '';
	}

	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return '';
	}

	$id = sanitize_key( $raw );

	return (string) apply_filters( 'openstation_solo_window_id', $id, $raw );
}

function openstation_is_solo_request() {
	return '' !== openstation_solo_window_id();
}
