<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_wallpaper( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Wallpaper id is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'        => '',
		'preview'      => '',
		'type'         => 'canvas',
		'value'        => '',
		'script'       => '',
		'description'  => '',
		'tone'         => '',
		'capabilities' => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

					__( 'Current user lacks the %s capability required to register this wallpaper.', 'desktop-mode' ),
					(string) $cap
				),
				array(
					'capability' => (string) $cap,
					'id'         => $id,
				)
			);
		}
	}
	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Wallpaper registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	$type = in_array( $args['type'], array( 'css', 'canvas' ), true )
		? $args['type']
		: 'canvas';

	if ( 'canvas' === $type && '' === (string) $args['script'] ) {
		return openstation_registration_error(
			'openstation_missing_script',
			__( 'Canvas wallpaper registration requires a `script` handle that publishes the def.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$value = (string) $args['value'];
	if ( '' === $value ) {
		$value = (string) $args['preview'];
	}

	$entry = array(
		'id'          => $id,

		'label'       => sanitize_text_field( (string) $args['label'] ),
		'preview'     => (string) $args['preview'],
		'type'        => $type,
		'value'       => $value,
		'script'      => (string) $args['script'],

		'description' => sanitize_textarea_field( (string) $args['description'] ),

		'tone'        => in_array( $args['tone'], array( 'light', 'dark' ), true ) ? (string) $args['tone'] : '',
	);
	openstation_desktop_wallpaper_registry( $id, $entry );

	do_action( 'openstation_wallpaper_registered', $id, $entry );

	return true;
}

function openstation_desktop_wallpaper_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

function openstation_build_desktop_wallpapers_payload() {
	$registry = openstation_desktop_wallpaper_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$registry = apply_filters( 'openstation_wallpapers', $registry );
	if ( ! is_array( $registry ) ) {
		return array();
	}
	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['id'] ) ) {
			continue;
		}
		$handle  = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		$payload = openstation_resolve_script_payload( $handle );
		$out[]   = array(
			'id'                 => (string) $entry['id'],
			'label'              => isset( $entry['label'] ) ? (string) $entry['label'] : '',
			'preview'            => isset( $entry['preview'] ) ? (string) $entry['preview'] : '',
			'type'               => isset( $entry['type'] ) ? (string) $entry['type'] : 'canvas',
			'value'              => isset( $entry['value'] ) ? (string) $entry['value'] : '',
			'description'        => isset( $entry['description'] ) ? (string) $entry['description'] : '',
			'tone'               => isset( $entry['tone'] ) ? (string) $entry['tone'] : '',
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
