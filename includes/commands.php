<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_command_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Command script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_desktop_command_script_registry( $handle, true );

	do_action( 'openstation_command_script_registered', $handle );

	return true;
}

function openstation_register_command( $args = array() ) {
	$defaults = array(
		'slug'        => '',
		'label'       => '',
		'description' => '',
		'icon'        => 'dashicons-arrow-right-alt',
		'hint'        => '',
		'script'      => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$slug = (string) $args['slug'];
	if ( '' === $slug ) {
		return openstation_registration_error(
			'openstation_missing_slug',
			__( 'Command registration requires a non-empty `slug`.', 'desktop-mode' )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Command registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'slug' => $slug )
		);
	}

	$entry = array(
		'slug'        => $slug,
		'label'       => (string) $args['label'],
		'description' => (string) $args['description'],
		'icon'        => (string) $args['icon'],
		'hint'        => (string) $args['hint'],
		'script'      => (string) $args['script'],
	);
	openstation_desktop_command_registry( $slug, $entry );

	if ( '' !== $entry['script'] ) {
		openstation_register_command_script( $entry['script'] );
	}

	do_action( 'openstation_command_registered', $slug, $entry );

	return true;
}

function openstation_desktop_command_script_registry( $handle = '', $value = null ) {
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

function openstation_flush_desktop_command_script_registry() {
	openstation_desktop_command_script_registry( '__flush__' );
}

function openstation_desktop_command_registry( $slug = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $slug ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $slug ] = $entry;
	}
	return isset( $store[ (string) $slug ] ) ? $store[ (string) $slug ] : null;
}

function openstation_build_desktop_command_scripts_payload() {
	$registry = openstation_desktop_command_script_registry();
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
				'openstation_register_command_script',
				'Command',
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

function openstation_build_desktop_commands_payload() {
	$registry = openstation_desktop_command_registry();
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
			'slug'               => (string) $entry['slug'],
			'label'              => (string) $entry['label'],
			'description'        => (string) $entry['description'],
			'icon'               => (string) $entry['icon'],
			'hint'               => (string) $entry['hint'],
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
