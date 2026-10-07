<?php

defined( 'ABSPATH' ) || exit;

function openstation_strip_chromeless_flag_from_media_grid() {
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( ! $screen || 'upload' !== $screen->id ) {
		return;
	}

	$scripts = wp_scripts();
	$data    = $scripts->get_data( 'media-grid', 'data' );
	if ( ! is_string( $data ) || '' === $data ) {
		return;
	}

	if ( ! preg_match_all( '/^var _wpMediaGridSettings = (.+);$/m', $data, $matches ) ) {
		return;
	}

	$settings = json_decode( end( $matches[1] ) );
	if ( ! $settings instanceof stdClass || ! isset( $settings->queryVars ) || ! $settings->queryVars instanceof stdClass ) {
		return;
	}

	if ( ! isset( $settings->queryVars->openstation_chromeless ) ) {
		return;
	}

	unset( $settings->queryVars->openstation_chromeless );

	wp_localize_script( 'media-grid', '_wpMediaGridSettings', (array) $settings );
}
add_action( 'admin_enqueue_scripts', 'openstation_strip_chromeless_flag_from_media_grid', 999 );
