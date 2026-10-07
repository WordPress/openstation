<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_NATIVE_WINDOW_MAIN_TAB = 'main';

function openstation_register_window_tab( $window_id, $args = array() ) {
	$window_id = sanitize_key( (string) $window_id );
	if ( '' === $window_id ) {
		return openstation_registration_error(
			'openstation_missing_window_id',
			__( 'Window id is required when registering a tab.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'value'        => '',
		'label'        => '',
		'template'     => null,
		'script'       => '',
		'position'     => 100,
		'capabilities' => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

					__( 'Current user lacks the %s capability required to register this window tab.', 'desktop-mode' ),
					(string) $cap
				),
				array(
					'capability' => (string) $cap,
					'window_id'  => $window_id,
				)
			);
		}
	}

	$value_raw = strtolower( trim( (string) $args['value'] ) );
	if ( '' === $value_raw ) {
		return openstation_registration_error(
			'openstation_missing_tab_value',
			__( 'Window tab registration requires a non-empty `value`.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}
	if ( ! preg_match( '/^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/', $value_raw ) ) {
		return openstation_registration_error(
			'openstation_invalid_tab_value',
			sprintf(

				__( 'Window tab `value` "%s" must match /^[a-z0-9_-]+(\/[a-z0-9_-]+)?$/ — lowercase alphanum + hyphen/underscore, with at most one `vendor/sub-id` slash.', 'desktop-mode' ),
				$value_raw
			),
			array(
				'window_id' => $window_id,
				'value'     => $value_raw,
			)
		);
	}
	$value = $value_raw;
	if ( OPENSTATION_NATIVE_WINDOW_MAIN_TAB === $value ) {
		return openstation_registration_error(
			'openstation_reserved_tab_value',
			sprintf(

				__( 'The tab value "%s" is reserved for the window\'s own template tab.', 'desktop-mode' ),
				OPENSTATION_NATIVE_WINDOW_MAIN_TAB
			),
			array(
				'window_id' => $window_id,
				'value'     => $value,
			)
		);
	}
	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Window tab registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}
	if ( ! is_callable( $args['template'] ) ) {
		return openstation_registration_error(
			'openstation_invalid_template',
			__( 'Window tab registration requires a callable `template` that echoes the pane body.', 'desktop-mode' ),
			array( 'window_id' => $window_id )
		);
	}

	$entry = array(
		'value'    => $value,
		'label'    => (string) $args['label'],
		'template' => $args['template'],
		'script'   => (string) $args['script'],
		'position' => (int) $args['position'],
	);
	openstation_desktop_window_tab_registry( $window_id, $value, $entry );

	do_action( 'openstation_window_tab_registered', $window_id, $value, $entry );

	return true;
}

function openstation_desktop_window_tab_registry( $window_id = '', $value = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $window_id ) {
		return $store;
	}
	if ( ! isset( $store[ $window_id ] ) ) {
		$store[ $window_id ] = array();
	}
	if ( '' === (string) $value ) {
		return $store[ $window_id ];
	}
	if ( null !== $entry ) {
		$store[ $window_id ][ $value ] = $entry;
	}
	return isset( $store[ $window_id ][ $value ] )
		? $store[ $window_id ][ $value ]
		: null;
}

function openstation_get_native_window_tabs( $window_id ) {
	$window = openstation_native_window_registry( (string) $window_id );
	if ( ! is_array( $window ) ) {
		return array();
	}

	$extras = openstation_desktop_window_tab_registry( $window_id );
	if ( ! is_array( $extras ) ) {
		$extras = array();
	}

	$main_label = '' !== (string) $window['main_tab_label']
		? (string) $window['main_tab_label']
		: (string) $window['title'];
	$tabs       = array(
		array(
			'value'    => OPENSTATION_NATIVE_WINDOW_MAIN_TAB,
			'label'    => $main_label,
			'template' => $window['template'],
			'script'   => '',
			'is_main'  => true,
			'position' => 0,
		),
	);

	$sorted = array_values( $extras );
	usort(
		$sorted,
		static function ( $a, $b ) {
			if ( $a['position'] === $b['position'] ) {
				return 0;
			}
			return $a['position'] < $b['position'] ? -1 : 1;
		}
	);
	foreach ( $sorted as $tab ) {
		$tabs[] = array(
			'value'    => $tab['value'],
			'label'    => $tab['label'],
			'template' => $tab['template'],
			'script'   => $tab['script'],
			'is_main'  => false,
			'position' => $tab['position'],
		);
	}

	$filtered = apply_filters( 'openstation_window_tabs', $tabs, $window_id );
	return is_array( $filtered ) ? $filtered : $tabs;
}
