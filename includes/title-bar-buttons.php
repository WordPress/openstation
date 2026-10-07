<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_titlebar_button_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Title-bar button script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_desktop_titlebar_button_script_registry( $handle, true );

	do_action( 'openstation_titlebar_button_script_registered', $handle );

	return true;
}

function openstation_desktop_titlebar_button_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

function openstation_flush_desktop_titlebar_button_script_registry() {
	openstation_desktop_titlebar_button_script_registry( '__flush__' );
}

function openstation_build_desktop_titlebar_button_scripts_payload() {
	$registry = openstation_desktop_titlebar_button_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {

			openstation_warn_unresolvable_script_handle(
				'openstation_register_titlebar_button_script',
				'Title-bar button',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $handle ),
		);
		$seen[ $handle ] = true;
	}
	return $out;
}
