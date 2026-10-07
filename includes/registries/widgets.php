<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_widget( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Widget id is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'          => '',
		'description'    => '',
		'icon'           => 'dashicons-admin-generic',
		'script'         => '',
		'movable'        => false,
		'resizable'      => false,
		'min_width'      => 0,
		'min_height'     => 0,
		'max_width'      => 0,
		'max_height'     => 0,
		'default_width'  => 0,
		'default_height' => 0,
		'capabilities'   => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

					__( 'Current user lacks the %s capability required to register this widget.', 'desktop-mode' ),
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
			__( 'Widget registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'             => $id,
		'label'          => (string) $args['label'],
		'description'    => (string) $args['description'],
		'icon'           => (string) $args['icon'],
		'script'         => (string) $args['script'],
		'movable'        => (bool) $args['movable'],
		'resizable'      => (bool) $args['resizable'],
		'min_width'      => (int) $args['min_width'],
		'min_height'     => (int) $args['min_height'],
		'max_width'      => (int) $args['max_width'],
		'max_height'     => (int) $args['max_height'],
		'default_width'  => (int) $args['default_width'],
		'default_height' => (int) $args['default_height'],
	);
	openstation_desktop_widget_registry( $id, $entry );

	do_action( 'openstation_widget_registered', $id, $entry );

	return true;
}

function openstation_desktop_widget_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

function openstation_build_desktop_widgets_payload() {
	$registry = openstation_desktop_widget_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$script_payload = openstation_resolve_script_payload( $entry['script'] );

		$out[] = array(
			'id'                 => $entry['id'],
			'label'              => $entry['label'],
			'description'        => $entry['description'],
			'icon'               => $entry['icon'],
			'movable'            => $entry['movable'],
			'resizable'          => $entry['resizable'],
			'minWidth'           => $entry['min_width'],
			'minHeight'          => $entry['min_height'],
			'maxWidth'           => $entry['max_width'],
			'maxHeight'          => $entry['max_height'],
			'defaultWidth'       => $entry['default_width'],
			'defaultHeight'      => $entry['default_height'],
			'scriptUrl'          => $script_payload['url'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $entry['script'] ),
			'scriptHandle'       => $entry['script'],
			'scriptBefore'       => $script_payload['before'],
			'scriptAfter'        => $script_payload['after'],
			'scriptL10n'         => $script_payload['l10n'],
			'scriptTranslations' => $script_payload['translations'],
		);
	}
	return $out;
}
