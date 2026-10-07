<?php

defined( 'ABSPATH' ) || exit;

const OPENSTATION_STATION_HOME_CARD_PREFERENCES_META = 'openstation_station_home_card_preferences';

function openstation_register_station_home_card( $id, $args = array() ) {
	$raw_id = (string) $id;
	$id     = sanitize_key( $raw_id );
	if ( '' === $id || $raw_id !== $id ) {
		return openstation_registration_error(
			'openstation_invalid_station_home_card_id',
			__( 'Station Home card id is required and must be a valid slug.', 'desktop-mode' )
		);
	}

	$args = wp_parse_args(
		$args,
		array(
			'label'           => '',
			'description'     => '',
			'provider'        => '',
			'icon'            => 'dashicons-admin-plugins',
			'callback'        => null,
			'default_enabled' => false,
			'order'           => 10,
			'capabilities'    => array(),
		)
	);

	foreach ( (array) $args['capabilities'] as $capability ) {
		if ( ! current_user_can( (string) $capability ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(

					__( 'Current user lacks the %s capability required to register this Station Home card.', 'desktop-mode' ),
					(string) $capability
				),
				array(
					'capability' => (string) $capability,
					'id'         => $id,
				)
			);
		}
	}

	$label = sanitize_text_field( (string) $args['label'] );
	if ( '' === $label ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Station Home card registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	if ( ! is_callable( $args['callback'] ) ) {
		return openstation_registration_error(
			'openstation_invalid_callback',
			__( 'Station Home card registration requires a callable `callback`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$entry = array(
		'id'              => $id,
		'label'           => $label,
		'description'     => sanitize_textarea_field( (string) $args['description'] ),
		'provider'        => sanitize_text_field( (string) $args['provider'] ),
		'icon'            => openstation_sanitize_dock_icon( (string) $args['icon'] ),
		'callback'        => $args['callback'],
		'default_enabled' => (bool) $args['default_enabled'],
		'order'           => (int) $args['order'],
	);
	openstation_station_home_card_registry( $id, $entry );

	do_action( 'openstation_station_home_card_registered', $id, $entry );

	return true;
}

function openstation_station_home_card_registry( $id = '', $entry = null ) {
	static $registry = null;
	if ( null === $registry ) {
		$registry = openstation_create_registry();
	}
	return $registry( $id, $entry );
}

function openstation_unregister_station_home_card( $id ) {
	$id = sanitize_key( (string) $id );
	if ( '' === $id || null === openstation_station_home_card_registry( $id ) ) {
		return false;
	}

	$cards = openstation_station_home_card_registry();
	unset( $cards[ $id ] );
	openstation_station_home_card_registry( '__flush__' );
	foreach ( $cards as $card_id => $entry ) {
		openstation_station_home_card_registry( $card_id, $entry );
	}
	return true;
}

function openstation_station_home_get_registered_cards() {
	$cards = openstation_station_home_card_registry();

	$cards = apply_filters( 'openstation_station_home_cards', $cards, get_current_user_id() );
	if ( ! is_array( $cards ) ) {
		return array();
	}

	$normalized = array();
	foreach ( $cards as $key => $entry ) {
		if ( ! is_array( $entry ) || ! is_callable( $entry['callback'] ?? null ) ) {
			continue;
		}
		$allowed = true;
		foreach ( (array) ( $entry['capabilities'] ?? array() ) as $capability ) {
			if ( ! current_user_can( (string) $capability ) ) {
				$allowed = false;
				break;
			}
		}
		if ( ! $allowed ) {
			continue;
		}
		$id    = sanitize_key( (string) ( $entry['id'] ?? $key ) );
		$label = sanitize_text_field( (string) ( $entry['label'] ?? '' ) );
		if ( '' === $id || '' === $label ) {
			continue;
		}
		$normalized[ $id ] = array(
			'id'              => $id,
			'label'           => $label,
			'description'     => sanitize_textarea_field( (string) ( $entry['description'] ?? '' ) ),
			'provider'        => sanitize_text_field( (string) ( $entry['provider'] ?? '' ) ),
			'icon'            => openstation_sanitize_dock_icon( (string) ( $entry['icon'] ?? 'dashicons-admin-plugins' ) ),
			'callback'        => $entry['callback'],
			'default_enabled' => (bool) ( $entry['default_enabled'] ?? false ),
			'order'           => (int) ( $entry['order'] ?? 10 ),
		);
	}

	uasort(
		$normalized,
		static function ( $left, $right ) {
			$order = $left['order'] <=> $right['order'];
			return 0 !== $order ? $order : strcasecmp( $left['label'], $right['label'] );
		}
	);

	return $normalized;
}

function openstation_station_home_get_card_preferences( $user_id = 0 ) {
	$user_id = $user_id > 0 ? (int) $user_id : get_current_user_id();
	$stored  = get_user_meta( $user_id, OPENSTATION_STATION_HOME_CARD_PREFERENCES_META, true );
	if ( ! is_array( $stored ) ) {
		return array();
	}

	$preferences = array();
	foreach ( $stored as $id => $enabled ) {
		$id = sanitize_key( (string) $id );
		if ( '' !== $id ) {
			$preferences[ $id ] = (bool) $enabled;
		}
	}
	return $preferences;
}

function openstation_station_home_set_card_preference( $user_id, $id, $enabled ) {
	$user_id = (int) $user_id;
	$id      = sanitize_key( (string) $id );
	$cards   = openstation_station_home_get_registered_cards();
	if ( $user_id <= 0 || '' === $id || ! isset( $cards[ $id ] ) ) {
		return false;
	}

	$enabled            = (bool) $enabled;
	$preferences        = openstation_station_home_get_card_preferences( $user_id );
	$preferences[ $id ] = $enabled;
	update_user_meta( $user_id, OPENSTATION_STATION_HOME_CARD_PREFERENCES_META, $preferences );

	do_action( 'openstation_station_home_card_preference_updated', $user_id, $id, $enabled );

	return true;
}

function openstation_station_home_card_is_enabled( $id, $entry, $preferences ) {
	if ( array_key_exists( $id, $preferences ) ) {
		return (bool) $preferences[ $id ];
	}
	return (bool) $entry['default_enabled'];
}

function openstation_station_home_build_cards( $cards, $preferences ) {
	$payload         = array();
	$preference_rows = array();
	$user_id         = get_current_user_id();

	foreach ( $cards as $id => $entry ) {
		$enabled           = openstation_station_home_card_is_enabled( $id, $entry, $preferences );
		$preference_rows[] = array(
			'id'             => $id,
			'label'          => $entry['label'],
			'description'    => $entry['description'],
			'provider'       => $entry['provider'],
			'icon'           => $entry['icon'],
			'enabled'        => $enabled,
			'defaultEnabled' => (bool) $entry['default_enabled'],
		);

		if ( ! $enabled ) {
			continue;
		}

		try {
			$data = call_user_func( $entry['callback'], $user_id, $entry );
		} catch ( Throwable $error ) {

			do_action( 'openstation_station_home_card_error', $error, $id, $entry );
			continue;
		}
		if ( is_wp_error( $data ) || ! is_array( $data ) ) {
			continue;
		}

		$data = apply_filters( 'openstation_station_home_card_data', $data, $id, $entry, $user_id );
		if ( ! is_array( $data ) ) {
			continue;
		}

		$tone = (string) ( $data['tone'] ?? 'neutral' );
		if ( ! in_array( $tone, array( 'neutral', 'info', 'success', 'warning', 'danger' ), true ) ) {
			$tone = 'neutral';
		}

		$payload[] = array(
			'id'          => $id,
			'label'       => $entry['label'],
			'description' => $entry['description'],
			'provider'    => $entry['provider'],
			'icon'        => $entry['icon'],
			'value'       => sanitize_text_field( (string) ( $data['value'] ?? '' ) ),
			'detail'      => sanitize_textarea_field( (string) ( $data['detail'] ?? '' ) ),
			'url'         => esc_url_raw( (string) ( $data['url'] ?? '' ) ),
			'actionLabel' => sanitize_text_field( (string) ( $data['action_label'] ?? '' ) ),
			'external'    => (bool) ( $data['external'] ?? false ),
			'tone'        => $tone,
		);
	}

	return array(
		'cards'       => $payload,
		'preferences' => $preference_rows,
	);
}
