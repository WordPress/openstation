<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_LEGACY_THEME_ID = 'desktop-mode/legacy';

function openstation_legacy_theme_manifest_path() {

	return (string) apply_filters(
		'openstation_legacy_theme_manifest_path',
		OPENSTATION_DIR . 'assets/desktop-themes/legacy/theme.json'
	);
}

function openstation_legacy_theme_tokens() {
	$manifest = openstation_legacy_theme_manifest();
	return isset( $manifest['tokens'] ) && is_array( $manifest['tokens'] )
		? $manifest['tokens']
		: array();
}

function openstation_legacy_theme_manifest() {
	static $manifest = null;
	if ( null !== $manifest ) {
		return $manifest;
	}

	$manifest = array();
	$path     = openstation_legacy_theme_manifest_path();
	if ( ! is_readable( $path ) ) {
		return $manifest;
	}

	$decoded = wp_json_file_decode( $path, array( 'associative' => true ) );
	if ( is_array( $decoded ) ) {
		$manifest = $decoded;
	}
	return $manifest;
}

function openstation_register_builtin_desktop_themes() {
	$manifest = openstation_legacy_theme_manifest();
	$tokens   = openstation_legacy_theme_tokens();
	if ( empty( $tokens ) ) {
		return;
	}

	$recommended = isset( $manifest['recommendedOsSettings'] ) && is_array( $manifest['recommendedOsSettings'] )
		? $manifest['recommendedOsSettings']
		: array();

	openstation_register_desktop_theme(
		OPENSTATION_LEGACY_THEME_ID,
		array(
			'name'                  => __( 'Desktop Mode (Legacy)', 'desktop-mode' ),
			'version'               => '1.0.0',
			'author'                => 'OpenStation',
			'description'           => __( 'The look Desktop Mode had before the OpenStation brand: every design token at the value it resolved to then. Wear it to put the old palette back, or fork it as the starting point for a theme of your own.', 'desktop-mode' ),

			'preview'               => OPENSTATION_URL . 'assets/desktop-themes/legacy/preview.svg',
			'tokens'                => $tokens,
			'recommendedOsSettings' => $recommended,
		)
	);
}

if ( openstation_request_needs_admin_modules() ) {
	add_action( 'init', 'openstation_register_builtin_desktop_themes', 5 );
}
