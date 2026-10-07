<?php

defined( 'ABSPATH' ) || exit;

function openstation_asset_suffix() {
	static $suffix = null;
	if ( null !== $suffix ) {
		return $suffix;
	}
	if ( ! ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ) {
		$suffix = '.min';
		return $suffix;
	}
	$suffix = file_exists( OPENSTATION_DIR . 'assets/js/desktop.js' ) ? '' : '.min';
	return $suffix;
}

function openstation_is_enabled( $user_id = 0 ) {
	$user_id = (int) $user_id;
	if ( $user_id <= 0 ) {
		if ( ! is_user_logged_in() ) {
			return false;
		}
		$user_id = get_current_user_id();
	}

	if ( '1' !== (string) get_user_meta( $user_id, 'desktop_mode_mode', true ) ) {
		return false;
	}

	return (bool) apply_filters( 'openstation_mode_enabled', true, $user_id );
}

function openstation_rest_require_enabled() {
	if ( ! is_user_logged_in() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'Authentication required.', 'desktop-mode' ),
			array( 'status' => 401 )
		);
	}

	if ( ! openstation_is_enabled() ) {
		return new WP_Error(
			'rest_forbidden',
			__( 'OpenStation is not enabled for your account.', 'desktop-mode' ),
			array( 'status' => 403 )
		);
	}

	return true;
}

function openstation_get_default_wallpaper() {

	$id = apply_filters( 'openstation_default_wallpaper', 'galaxy' );
	if ( ! is_string( $id ) ) {
		return '';
	}
	return sanitize_key( $id );
}

function openstation_site_title() {
	$title = wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES );
	$title = trim( $title );

	if ( '' === $title ) {
		$title = __( 'WordPress', 'desktop-mode' );
	}

	$filtered = apply_filters( 'openstation_site_title', $title );

	return is_string( $filtered ) && '' !== trim( $filtered ) ? $filtered : $title;
}

function openstation_plain_text_title( $rendered ) {
	$decoded = html_entity_decode(
		(string) $rendered,
		ENT_QUOTES,
		get_bloginfo( 'charset' )
	);

	$tag_start = '[a-zA-Z\/!?]';
	$text      = str_replace( '&', '&amp;', $decoded );
	$text      = openstation_strip_all_tags( $text );
	$text      = str_replace( '&lt;', '<', $text );
	$text      = str_replace( '&amp;', '&', $text );

	return trim( preg_replace( "/<(?={$tag_start})/", '< ', $text ) );
}

function openstation_strip_all_tags( $html ) {
	return wp_strip_all_tags(
		preg_replace( '/<(?![a-zA-Z\/!?])/', '&lt;', (string) $html )
	);
}

function openstation_registration_error( $code, $message, $data = array() ) {
	return new WP_Error(
		(string) $code,
		(string) $message,
		is_array( $data ) ? $data : array()
	);
}
