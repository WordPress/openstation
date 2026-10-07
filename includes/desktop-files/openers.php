<?php

defined( 'ABSPATH' ) || exit;

define( 'OPENSTATION_FILE_ASSOCIATIONS_META', 'desktop_mode_file_associations' );

function openstation_file_opener_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

function openstation_register_file_opener( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Opener id is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'        => '',
		'types'        => array(),
		'is_default'   => false,
		'sort'         => 100,
		'script'       => '',
		'capabilities' => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

					__( 'Current user lacks the %s capability required to register this opener.', 'desktop-mode' ),
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
			__( 'Opener registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$types = array_values( array_filter( array_map( 'strval', (array) $args['types'] ) ) );
	if ( empty( $types ) ) {
		return openstation_registration_error(
			'openstation_missing_types',
			__( 'Opener registration requires at least one file `type`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'         => $id,
		'label'      => (string) $args['label'],
		'types'      => $types,
		'is_default' => (bool) $args['is_default'],
		'sort'       => (int) $args['sort'],
		'script'     => (string) $args['script'],
	);
	openstation_file_opener_registry( $id, $entry );

	do_action( 'openstation_file_opener_registered', $id, $entry );

	return true;
}

function openstation_get_file_openers() {
	$registry = openstation_file_opener_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$registry = apply_filters( 'openstation_file_openers', $registry );
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
			return strcmp(
				isset( $a['label'] ) ? (string) $a['label'] : '',
				isset( $b['label'] ) ? (string) $b['label'] : ''
			);
		}
	);
	return $entries;
}

function openstation_get_file_openers_for_type( $type ) {
	$type = (string) $type;
	if ( '' === $type ) {
		return array();
	}
	return array_values(
		array_filter(
			openstation_get_file_openers(),
			static function ( $entry ) use ( $type ) {
				return in_array( $type, (array) $entry['types'], true );
			}
		)
	);
}

function openstation_resolve_file_opener_id( $type, $user_id ) {
	$candidates = openstation_get_file_openers_for_type( $type );
	if ( empty( $candidates ) ) {
		return '';
	}
	$by_id = array();
	foreach ( $candidates as $entry ) {
		$by_id[ $entry['id'] ] = $entry;
	}

	$override = '';
	if ( $user_id > 0 ) {
		$assoc = get_user_meta( (int) $user_id, OPENSTATION_FILE_ASSOCIATIONS_META, true );
		if ( is_array( $assoc ) && isset( $assoc[ $type ] ) ) {
			$override = (string) $assoc[ $type ];
		}
	}
	if ( '' !== $override && isset( $by_id[ $override ] ) ) {
		$resolved = $override;
	} else {

		$resolved = '';
		foreach ( $candidates as $entry ) {
			if ( ! empty( $entry['is_default'] ) ) {
				$resolved = (string) $entry['id'];
				break;
			}
		}

		if ( '' === $resolved ) {
			$resolved = (string) $candidates[0]['id'];
		}
	}

	return (string) apply_filters( 'openstation_resolve_file_opener', $resolved, $type, $user_id );
}

function openstation_build_file_openers_payload() {
	$entries = openstation_get_file_openers();
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
			'id'                 => (string) $entry['id'],
			'label'              => (string) $entry['label'],
			'types'              => array_values( (array) $entry['types'] ),
			'isDefault'          => (bool) $entry['is_default'],
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

function openstation_get_user_file_associations( $user_id ) {
	if ( $user_id <= 0 ) {
		return array();
	}
	$raw = get_user_meta( (int) $user_id, OPENSTATION_FILE_ASSOCIATIONS_META, true );
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$openers = openstation_get_file_openers();
	$known   = array();
	foreach ( $openers as $entry ) {
		$known[ (string) $entry['id'] ] = (array) $entry['types'];
	}
	$out = array();
	foreach ( $raw as $type => $opener_id ) {
		$type      = (string) $type;
		$opener_id = (string) $opener_id;
		if ( ! isset( $known[ $opener_id ] ) ) {
			continue;
		}
		if ( ! in_array( $type, $known[ $opener_id ], true ) ) {
			continue;
		}
		$out[ $type ] = $opener_id;
	}
	return $out;
}
