<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_settings_tab_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Settings tab script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_desktop_settings_tab_script_registry( $handle, true );

	do_action( 'openstation_settings_tab_script_registered', $handle );

	return true;
}

function openstation_register_settings_tab( $args = array() ) {
	$defaults = array(
		'id'         => '',
		'label'      => '',
		'capability' => '',
		'order'      => 100,
		'script'     => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id || ! preg_match( '/^[a-z0-9_\-]+$/', $id ) ) {
		return openstation_registration_error(
			'openstation_invalid_id',
			__( 'Settings tab registration requires a non-empty `id` matching [a-z0-9_-]+.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Settings tab registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'         => $id,
		'label'      => (string) $args['label'],
		'capability' => (string) $args['capability'],
		'order'      => (int) $args['order'],
		'script'     => (string) $args['script'],
	);
	openstation_desktop_settings_tab_registry( $id, $entry );

	if ( '' !== $entry['script'] ) {
		openstation_register_settings_tab_script( $entry['script'] );
	}

	do_action( 'openstation_settings_tab_registered', $id, $entry );

	return true;
}

function openstation_desktop_settings_tab_script_registry( $handle = '', $value = null ) {
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

function openstation_flush_desktop_settings_tab_script_registry() {
	openstation_desktop_settings_tab_script_registry( '__flush__' );
}

function openstation_desktop_settings_tab_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

function openstation_build_desktop_settings_tab_scripts_payload() {
	$registry = openstation_desktop_settings_tab_script_registry();
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
				'openstation_register_settings_tab_script',
				'Settings-tab',
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

function openstation_build_desktop_settings_tabs_payload() {
	$registry = openstation_desktop_settings_tab_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$handle  = (string) $entry['script'];
		$payload = '' !== $handle
			? openstation_resolve_script_payload( $handle )
			: array(
				'url'          => '',
				'before'       => array(),
				'after'        => array(),
				'l10n'         => array(),
				'translations' => '',
			);
		$out[]   = array(
			'id'                 => (string) $entry['id'],
			'label'              => (string) $entry['label'],
			'capability'         => (string) $entry['capability'],
			'order'              => (int) $entry['order'],
			'scriptUrl'          => $payload['url'],
			'scriptHandle'       => $handle,
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $handle ),
		);
	}
	return $out;
}
