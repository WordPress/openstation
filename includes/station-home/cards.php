<?php
/**
 * OpenStation — Station Home cards.
 *
 * Third-party plugins register small, structured cards here instead of
 * injecting arbitrary markup into Station Home. Cards are user-controlled:
 * each declaration chooses an initial state and every user can subsequently
 * opt in or out without changing the plugin's site-wide configuration.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** Per-user map of explicit Station Home card choices (`card-id => bool`). */
const OPENSTATION_STATION_HOME_CARD_PREFERENCES_META = 'openstation_station_home_card_preferences';

/**
 * Register a card contributed by a plugin to Station Home.
 *
 * The callback runs only when the current user has enabled the card. It
 * returns structured, plain-text data so the Station Home renderer keeps
 * ownership of accessibility, layout, responsive behavior, and theming.
 *
 * Example:
 *
 * ```php
 * openstation_register_station_home_card( 'my-plugin-orders', array(
 *     'label'           => __( 'Orders', 'my-plugin' ),
 *     'description'     => __( 'Orders waiting to be fulfilled.', 'my-plugin' ),
 *     'provider'        => __( 'My Plugin', 'my-plugin' ),
 *     'icon'            => 'dashicons-cart',
 *     'default_enabled' => false,
 *     'capabilities'    => array( 'manage_options' ),
 *     'callback'        => function () {
 *         return array(
 *             'value'        => '4',
 *             'detail'       => __( 'Ready to fulfil', 'my-plugin' ),
 *             'url'          => admin_url( 'admin.php?page=my-plugin-orders' ),
 *             'action_label' => __( 'Open orders', 'my-plugin' ),
 *             'tone'         => 'warning',
 *         );
 *     },
 * ) );
 * ```
 *
 * @param string $id   Unique kebab-case card id.
 * @param array  $args {
 *     Card registration options.
 *
 *     @type string   $label           Human-readable card name. Required.
 *     @type string   $description     Explanation shown in the card picker.
 *     @type string   $provider        Plugin/provider name shown on the card.
 *     @type string   $icon            Dashicon class or safe image URL.
 *     @type callable $callback        Returns the current card data. Required.
 *     @type bool     $default_enabled Initial state until the user chooses.
 *     @type int      $order           Sort order within the contributed area.
 *     @type string[] $capabilities    Gate: ALL capabilities must match.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
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
					/* translators: %s: capability slug. */
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

	/**
	 * Fires after a Station Home card is successfully registered.
	 *
	 * @param string $id    Card id.
	 * @param array  $entry Stored registry entry.
	 */
	do_action( 'openstation_station_home_card_registered', $id, $entry );

	return true;
}

/**
 * Internal Station Home card registry.
 *
 * @internal
 *
 * @param string     $id    Card id, empty for all, or `__flush__` for tests.
 * @param array|null $entry Entry to write.
 * @return array|null
 */
function openstation_station_home_card_registry( $id = '', $entry = null ) {
	static $registry = null;
	if ( null === $registry ) {
		$registry = openstation_create_registry();
	}
	return $registry( $id, $entry );
}

/**
 * Remove a Station Home card registration.
 *
 * @param string $id Card id.
 * @return bool Whether a card was removed.
 */
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

/**
 * Return the post-filter card registry in deterministic display order.
 *
 * @return array[] Entries keyed by card id.
 */
function openstation_station_home_get_registered_cards() {
	$cards = openstation_station_home_card_registry();

	/**
	 * Filters the registered Station Home cards for the current user.
	 *
	 * Plugins may add, remove, or replace entries. Added entries must use the
	 * same shape accepted by `openstation_register_station_home_card()`.
	 *
	 * @param array[] $cards   Entries keyed by card id.
	 * @param int     $user_id Current user id.
	 */
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

/**
 * Read a user's explicit Station Home card choices.
 *
 * @param int $user_id User id. Defaults to the current user.
 * @return array<string, bool>
 */
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

/**
 * Store one explicit card choice for a user.
 *
 * The write half of the preference map: the Station Home app's
 * Customize switches land here, and so may any plugin that wants to
 * flip a card on a user's behalf. Refuses ids that are not registered
 * for the current user, so a stale switch cannot mint a preference
 * for a card that no longer exists.
 *
 * @param int    $user_id User id.
 * @param string $id      Card id.
 * @param bool   $enabled New explicit state.
 * @return bool Whether the choice was stored.
 */
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

	/**
	 * Fires after a user opts in to or out of a Station Home card.
	 *
	 * @param int    $user_id User id.
	 * @param string $id      Card id.
	 * @param bool   $enabled New explicit state.
	 */
	do_action( 'openstation_station_home_card_preference_updated', $user_id, $id, $enabled );

	return true;
}

/**
 * Resolve a card's effective per-user enabled state.
 *
 * @param string $id          Card id.
 * @param array  $entry       Registry entry.
 * @param array  $preferences Explicit preference map.
 * @return bool
 */
function openstation_station_home_card_is_enabled( $id, $entry, $preferences ) {
	if ( array_key_exists( $id, $preferences ) ) {
		return (bool) $preferences[ $id ];
	}
	return (bool) $entry['default_enabled'];
}

/**
 * Build public preference rows and enabled card payloads for the snapshot.
 *
 * @param array[]             $cards       Registered card entries.
 * @param array<string, bool> $preferences Explicit user preferences.
 * @return array{cards: array[], preferences: array[]}
 */
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
			/**
			 * Fires when a contributed card callback throws.
			 *
			 * @param Throwable $error The callback error.
			 * @param string    $id    Card id.
			 * @param array     $entry Registry entry.
			 */
			do_action( 'openstation_station_home_card_error', $error, $id, $entry );
			continue;
		}
		if ( is_wp_error( $data ) || ! is_array( $data ) ) {
			continue;
		}

		/**
		 * Filters an enabled card's dynamic data before sanitization.
		 *
		 * @param array  $data    Callback data.
		 * @param string $id      Card id.
		 * @param array  $entry   Registry entry.
		 * @param int    $user_id Current user id.
		 */
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
