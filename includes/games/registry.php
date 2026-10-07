<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_game( $id, $args = array() ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Game id is required and must be a valid slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'title'         => '',
		'description'   => '',
		'icon'          => 'dashicons-admin-generic',
		'icon_svg'      => '',
		'script'        => '',
		'score_columns' => array(),
		'config'        => array(),
		'capabilities'  => array(),
		'window'        => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	$svg = trim( (string) $args['icon_svg'] );
	if ( '' !== $svg ) {

		if ( false !== stripos( $svg, '<script' ) ) {
			return openstation_registration_error(
				'openstation_invalid_icon_svg',
				__( 'Game `icon_svg` must not contain a <script> tag.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
		if ( 0 !== stripos( ltrim( $svg ), '<svg' ) ) {
			return openstation_registration_error(
				'openstation_invalid_icon_svg',
				__( 'Game `icon_svg` must start with a <svg> root element.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
		$args['icon'] = 'data:image/svg+xml;base64,' . base64_encode( $svg );
	}

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

					__( 'Current user lacks the %s capability required to register this game.', 'desktop-mode' ),
					(string) $cap
				),
				array(
					'capability' => (string) $cap,
					'id'         => $id,
				)
			);
		}
	}

	if ( '' === (string) $args['title'] ) {
		return openstation_registration_error(
			'openstation_missing_title',
			__( 'Game registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === (string) $args['script'] ) {
		return openstation_registration_error(
			'openstation_missing_script',
			__( 'Game registration requires a `script` handle that publishes the game def.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'            => $id,
		'title'         => (string) $args['title'],
		'description'   => sanitize_textarea_field( (string) $args['description'] ),
		'icon'          => openstation_sanitize_dock_icon( (string) $args['icon'] ),
		'script'        => (string) $args['script'],
		'score_columns' => openstation_games_sanitize_score_columns( $args['score_columns'] ),
		'config'        => is_array( $args['config'] ) ? $args['config'] : array(),
		'window'        => openstation_games_sanitize_window( $args['window'] ),
	);
	openstation_games_registry( $id, $entry );

	do_action( 'openstation_game_registered', $id, $entry );

	return true;
}

function openstation_games_sanitize_window( $window ) {
	if ( ! is_array( $window ) ) {
		return array();
	}
	$out = array();
	foreach ( array( 'width', 'height', 'minWidth', 'minHeight' ) as $key ) {
		if ( ! isset( $window[ $key ] ) || ! is_numeric( $window[ $key ] ) ) {
			continue;
		}
		$value = (int) $window[ $key ];
		if ( $value <= 0 ) {
			continue;
		}

		$out[ $key ] = min( $value, 10000 );
	}

	return $out;
}

function openstation_games_sanitize_score_columns( $columns ) {
	if ( ! is_array( $columns ) ) {
		return array();
	}
	$out = array();
	foreach ( $columns as $column ) {
		if ( ! is_array( $column ) ) {
			continue;
		}
		$key = sanitize_key( (string) ( $column['key'] ?? '' ) );
		if ( '' === $key ) {
			continue;
		}
		$label = sanitize_text_field( (string) ( $column['label'] ?? '' ) );
		$type  = (string) ( $column['type'] ?? 'number' );
		if ( ! in_array( $type, array( 'number', 'time', 'text' ), true ) ) {
			$type = 'number';
		}
		$out[] = array(
			'key'   => $key,
			'label' => '' !== $label ? $label : $key,
			'type'  => $type,
		);
	}
	return $out;
}

function openstation_games_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}

	if ( '__unset__' === $entry ) {
		unset( $store[ $id ] );
		return null;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

function openstation_unregister_game( $id ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id || null === openstation_games_registry( $id ) ) {
		return false;
	}
	openstation_games_registry( $id, '__unset__' );
	return true;
}

function openstation_games_get_registered() {
	$registry = openstation_games_registry();

	$registry = apply_filters( 'openstation_games', $registry );

	return is_array( $registry ) ? $registry : array();
}

function openstation_games_is_registered( $id ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return false;
	}
	$registry = openstation_games_get_registered();
	if ( isset( $registry[ $id ] ) ) {
		return true;
	}

	foreach ( $registry as $entry ) {
		if ( is_array( $entry ) && isset( $entry['id'] ) && (string) $entry['id'] === $id ) {
			return true;
		}
	}
	return false;
}

function openstation_build_desktop_games_payload() {

	if ( ! openstation_games_enabled() ) {
		return array();
	}
	$registry = openstation_games_get_registered();
	if ( empty( $registry ) ) {
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
			'title'              => isset( $entry['title'] ) ? (string) $entry['title'] : '',
			'description'        => isset( $entry['description'] ) ? (string) $entry['description'] : '',
			'icon'               => isset( $entry['icon'] ) ? (string) $entry['icon'] : '',
			'scoreColumns'       => isset( $entry['score_columns'] ) && is_array( $entry['score_columns'] )
				? array_map(
					static function ( $column ) {
						return array(
							'key'   => (string) $column['key'],
							'label' => (string) $column['label'],
							'type'  => (string) $column['type'],
						);
					},
					$entry['score_columns']
				)
				: array(),
			'config'             => array_merge(
				openstation_games_framework_config(),
				isset( $entry['config'] ) && is_array( $entry['config'] ) ? $entry['config'] : array()
			),

			'window'             => isset( $entry['window'] ) && is_array( $entry['window'] )
				? $entry['window']
				: array(),
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
