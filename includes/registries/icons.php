<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_icon( $id, $args = array() ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Desktop icon id is required and must be a valid slug.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'title'        => '',
		'icon'         => 'dashicons-admin-generic',
		'icon_svg'     => '',
		'window'       => '',
		'url'          => '',
		'position'     => 100,
		'pinned'       => false,
		'capabilities' => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	$svg = trim( (string) $args['icon_svg'] );
	if ( '' !== $svg ) {

		if ( false !== stripos( $svg, '<script' ) ) {
			return openstation_registration_error(
				'openstation_invalid_icon_svg',
				__( 'Desktop icon `icon_svg` must not contain a <script> tag.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
		if ( 0 !== stripos( ltrim( $svg ), '<svg' ) ) {
			return openstation_registration_error(
				'openstation_invalid_icon_svg',
				__( 'Desktop icon `icon_svg` must start with a <svg> root element.', 'desktop-mode' ),
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

					__( 'Current user lacks the %s capability required to register this desktop icon.', 'desktop-mode' ),
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
			__( 'Desktop icon registration requires a non-empty `title`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$window = sanitize_key( (string) $args['window'] );
	$url    = (string) $args['url'];
	if ( '' !== $window && '' !== $url ) {
		return openstation_registration_error(
			'openstation_conflicting_target',
			__( 'Desktop icon cannot declare both `window` and `url`; pick one target.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' === $window && '' === $url ) {
		return openstation_registration_error(
			'openstation_missing_target',
			__( 'Desktop icon must declare a `window` id or a `url` target.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( '' !== $url ) {

		$url = esc_url_raw( $url, array( 'http', 'https' ) );
		if ( '' === $url ) {
			return openstation_registration_error(
				'openstation_invalid_url',
				__( 'Desktop icon `url` must be a valid http(s) URL.', 'desktop-mode' ),
				array( 'id' => $id )
			);
		}
	}

	$entry = array(
		'id'       => $id,
		'title'    => (string) $args['title'],
		'icon'     => openstation_sanitize_dock_icon( (string) $args['icon'] ),
		'window'   => $window,
		'url'      => $url,
		'position' => (int) $args['position'],
		'pinned'   => (bool) $args['pinned'],
	);
	openstation_desktop_icon_registry( $id, $entry );

	do_action( 'openstation_icon_registered', $id, $entry );

	return true;
}

function openstation_desktop_icon_registry( $id = '', $entry = null ) {
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

function openstation_unregister_icon( $id ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id ) {
		return;
	}
	openstation_desktop_icon_registry( $id, '__unset__' );
}

function openstation_desktop_icon_entry( $id ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return null;
	}

	$registry = apply_filters( 'openstation_icons', openstation_desktop_icon_registry() );
	if ( ! is_array( $registry ) ) {
		return null;
	}
	if ( isset( $registry[ $id ] ) && is_array( $registry[ $id ] ) ) {
		return $registry[ $id ];
	}

	foreach ( $registry as $entry ) {
		if ( is_array( $entry ) && isset( $entry['id'] ) && $id === (string) $entry['id'] ) {
			return $entry;
		}
	}
	return null;
}

function openstation_build_desktop_icons_payload() {
	$registry = openstation_desktop_icon_registry();
	if ( ! is_array( $registry ) ) {
		$registry = array();
	}

	$registry = apply_filters( 'openstation_icons', $registry );

	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		if ( ! is_array( $entry ) || empty( $entry['id'] ) ) {
			continue;
		}
		$out[] = array(
			'id'       => (string) $entry['id'],
			'title'    => isset( $entry['title'] ) ? (string) $entry['title'] : '',
			'icon'     => isset( $entry['icon'] ) ? (string) $entry['icon'] : 'dashicons-admin-generic',
			'window'   => isset( $entry['window'] ) ? (string) $entry['window'] : '',
			'url'      => isset( $entry['url'] ) ? (string) $entry['url'] : '',
			'position' => isset( $entry['position'] ) ? (int) $entry['position'] : 100,
			'pinned'   => ! empty( $entry['pinned'] ),
		);
	}

	usort(
		$out,
		static function ( $a, $b ) {
			$ap = ! empty( $a['pinned'] ) ? 0 : 1;
			$bp = ! empty( $b['pinned'] ) ? 0 : 1;
			if ( $ap !== $bp ) {
				return $ap - $bp;
			}
			if ( $a['position'] === $b['position'] ) {
				return 0;
			}
			return $a['position'] < $b['position'] ? -1 : 1;
		}
	);

	return $out;
}
