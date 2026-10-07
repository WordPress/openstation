<?php

defined( 'ABSPATH' ) || exit;

function openstation_file_type_registry( $type = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $type ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $type ] = $entry;
	}
	return isset( $store[ (string) $type ] ) ? $store[ (string) $type ] : null;
}

function openstation_register_file_type( $type, $args = array() ) {
	$type = (string) $type;
	if ( '' === $type ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'File-type slug is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'        => '',
		'class'        => '',
		'script'       => '',
		'sort'         => 100,
		'capabilities' => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

					__( 'Current user lacks the %s capability required to register this file type.', 'desktop-mode' ),
					(string) $cap
				),
				array(
					'capability' => (string) $cap,
					'type'       => $type,
				)
			);
		}
	}

	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'File-type registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'type' => $type )
		);
	}

	$class = (string) $args['class'];
	if ( '' === $class || ! class_exists( $class ) ) {
		return openstation_registration_error(
			'openstation_invalid_class',
			__( 'File-type registration requires an existing `class`.', 'desktop-mode' ),
			array(
				'type'  => $type,
				'class' => $class,
			)
		);
	}
	if ( ! is_subclass_of( $class, 'OpenStation_File' ) ) {
		return openstation_registration_error(
			'openstation_invalid_class',
			__( '`class` must extend `OpenStation_File`.', 'desktop-mode' ),
			array(
				'type'  => $type,
				'class' => $class,
			)
		);
	}

	$entry = array(
		'type'   => $type,
		'label'  => (string) $args['label'],
		'class'  => $class,
		'script' => (string) $args['script'],
		'sort'   => (int) $args['sort'],
	);
	openstation_file_type_registry( $type, $entry );

	do_action( 'openstation_file_type_registered', $type, $entry );

	return true;
}

function openstation_get_file_type( $type ) {
	$entry = openstation_file_type_registry( (string) $type );
	return is_array( $entry ) ? $entry : null;
}

function openstation_get_file_types() {
	$registry = openstation_file_type_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$registry = apply_filters( 'openstation_file_types', $registry );
	if ( ! is_array( $registry ) ) {
		return array();
	}

	$entries = array_values( $registry );
	usort(
		$entries,
		static function ( $a, $b ) {
			$sa = isset( $a['sort'] ) ? (int) $a['sort'] : 100;
			$sb = isset( $b['sort'] ) ? (int) $b['sort'] : 100;
			if ( $sa !== $sb ) {
				return $sa - $sb;
			}
			$la = isset( $a['label'] ) ? (string) $a['label'] : '';
			$lb = isset( $b['label'] ) ? (string) $b['label'] : '';
			return strcmp( $la, $lb );
		}
	);
	return $entries;
}

function openstation_resolve_file( $type, $ref ) {
	$entry = openstation_get_file_type( $type );
	if ( null === $entry ) {
		return null;
	}
	$class = $entry['class'];
	if ( ! class_exists( $class ) ) {
		return null;
	}
	return new $class( $ref );
}

function openstation_build_file_types_payload() {
	$entries = openstation_get_file_types();
	if ( empty( $entries ) ) {
		return array();
	}
	$out = array();
	foreach ( $entries as $entry ) {
		$handle  = isset( $entry['script'] ) ? (string) $entry['script'] : '';
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
			'id'                 => (string) $entry['type'],
			'label'              => (string) $entry['label'],
			'sort'               => (int) $entry['sort'],
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
