<?php
/**
 * OpenStation — file-opener registry.
 *
 * An "opener" is the equivalent of a default-app association in a
 * desktop OS: it answers the question "what should happen when the
 * user double-clicks a `post` file?" with a discrete choice — open
 * Gutenberg, open the Classic Editor, open someone-else's modal,
 * etc. Multiple openers can register for the same file-type slug;
 * the user picks their preferred one in OS Settings → File
 * Associations (Phase 5), and the JS side resolves on every
 * double-click using this chain:
 *
 *   1. The user's per-type override (`desktop_mode_file_associations`
 *      user meta).
 *   2. The opener marked `is_default => true` for the type.
 *   3. The first registered opener for the type (sort order).
 *   4. No-op (the file simply can't be opened).
 *
 * The PHP side is metadata-only — opener handlers (URL builders,
 * JS callbacks) live on the JS side because closures don't
 * serialize across the shell payload. The JS module mirrors the
 * registration surface and ships a `handler` field with the
 * actual logic; the PHP entry feeds the OS Settings UI and
 * validates user-meta choices against the known set.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/** User-meta key holding `{ type => opener_id, … }`. */
define( 'OPEN_STATION_FILE_ASSOCIATIONS_META', 'desktop_mode_file_associations' );

/**
 * Internal static-store registry. Same pattern as the file-type
 * and wallpaper registries.
 *
 * @internal
 */
function open_station_file_opener_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

/**
 * Registers a file-opener.
 *
 * @param string $id   Opener id, e.g. `'gutenberg'`. Unique across
 *                     openers; collisions overwrite (late wins).
 * @param array  $args {
 *     @type string   $label        Required. Picker label.
 *     @type string[] $types        Required. File-type slugs this
 *                                  opener handles (`['post']`,
 *                                  `['post','page']`, etc.).
 *     @type bool     $is_default   Whether this opener is the
 *                                  ship-time default for ALL its
 *                                  types. The first matching
 *                                  default wins (registration
 *                                  order). Default false.
 *     @type int      $sort         Sort order in pickers. Default 100.
 *     @type string   $script       Optional handle the shell loads
 *                                  on activation so JS-side handlers
 *                                  defined in a plugin bundle appear
 *                                  without a page reload (Phase 5+).
 *     @type string[] $capabilities Gate: ALL caps must match.
 * }
 * @return true|WP_Error
 */
function open_station_register_file_opener( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return open_station_registration_error(
			'open_station_missing_id',
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
	$args = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return open_station_registration_error(
				'open_station_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this opener.', 'desktop-mode' ),
					(string) $cap
				),
				array( 'capability' => (string) $cap, 'id' => $id )
			);
		}
	}

	if ( '' === (string) $args['label'] ) {
		return open_station_registration_error(
			'open_station_missing_label',
			__( 'Opener registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	$types = array_values( array_filter( array_map( 'strval', (array) $args['types'] ) ) );
	if ( empty( $types ) ) {
		return open_station_registration_error(
			'open_station_missing_types',
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
	open_station_file_opener_registry( $id, $entry );

	/**
	 * Fires after a file opener is successfully registered. Does
	 * NOT fire on `WP_Error` returns.
	 *
	 * @param string $id    Opener id.
	 * @param array  $entry Stored registry entry.
	 */
	do_action( 'open_station_file_opener_registered', $id, $entry );

	return true;
}

/**
 * Returns every registered opener, sorted by `sort` then label.
 *
 * @return array[]
 */
function open_station_get_file_openers() {
	$registry = open_station_file_opener_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	/**
	 * Filters the opener registry before consumers see it. Plugins
	 * can hide built-ins, swap labels, or rearrange sort order.
	 *
	 * @param array[] $registry Registered openers keyed by id.
	 */
	$registry = apply_filters( 'open_station_file_openers', $registry );
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

/**
 * Returns openers that handle a given file type.
 *
 * @param string $type File-type slug.
 * @return array[]
 */
function open_station_get_file_openers_for_type( $type ) {
	$type = (string) $type;
	if ( '' === $type ) {
		return array();
	}
	return array_values(
		array_filter(
			open_station_get_file_openers(),
			static function ( $entry ) use ( $type ) {
				return in_array( $type, (array) $entry['types'], true );
			}
		)
	);
}

/**
 * Resolves the opener id that should open a `(type, ref)` tuple
 * for `$user_id`. Returns the id only — the JS side owns
 * dispatch.
 *
 * Resolution chain:
 *  1. User-meta override (per type).
 *  2. `is_default` opener for the type.
 *  3. First opener for the type (already sort-ordered).
 *
 * @param string $type    File-type slug.
 * @param int    $user_id Viewer.
 * @return string Opener id, or empty string when nothing matches.
 */
function open_station_resolve_file_opener_id( $type, $user_id ) {
	$candidates = open_station_get_file_openers_for_type( $type );
	if ( empty( $candidates ) ) {
		return '';
	}
	$by_id = array();
	foreach ( $candidates as $entry ) {
		$by_id[ $entry['id'] ] = $entry;
	}

	// 1. User override.
	$override = '';
	if ( $user_id > 0 ) {
		$assoc = get_user_meta( (int) $user_id, OPEN_STATION_FILE_ASSOCIATIONS_META, true );
		if ( is_array( $assoc ) && isset( $assoc[ $type ] ) ) {
			$override = (string) $assoc[ $type ];
		}
	}
	if ( '' !== $override && isset( $by_id[ $override ] ) ) {
		$resolved = $override;
	} else {
		// 2. Default opener.
		$resolved = '';
		foreach ( $candidates as $entry ) {
			if ( ! empty( $entry['is_default'] ) ) {
				$resolved = (string) $entry['id'];
				break;
			}
		}
		// 3. Fall back to the first registered opener.
		if ( '' === $resolved ) {
			$resolved = (string) $candidates[0]['id'];
		}
	}

	/**
	 * Filters the resolved opener id for a `(type, user_id)`
	 * tuple. Plugins can override the user's choice — useful for
	 * role-based forced associations or for AB-testing a new
	 * editor before promoting it to default.
	 *
	 * @param string $resolved Resolved opener id.
	 * @param string $type     File-type slug.
	 * @param int    $user_id  Viewer.
	 */
	return (string) apply_filters( 'open_station_resolve_file_opener', $resolved, $type, $user_id );
}

/**
 * Builds the openers payload sent to the shell.
 *
 * @return array[]
 */
function open_station_build_file_openers_payload() {
	$entries = open_station_get_file_openers();
	if ( empty( $entries ) ) {
		return array();
	}
	$out = array();
	foreach ( $entries as $entry ) {
		$handle  = isset( $entry['script'] ) ? (string) $entry['script'] : '';
		$payload = '' !== $handle
			? open_station_resolve_script_payload( $handle )
			: array(
				'url'          => '',
				'before'       => array(),
				'after'        => array(),
				'l10n'         => array(),
				'translations' => '',
			);
		$out[] = array(
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
		);
	}
	return $out;
}

/**
 * Returns the current user's `{ type => opener_id }` association
 * map, sanitized against the registered openers (entries pointing
 * at unknown ids are dropped from the returned map but kept in
 * meta — a deactivated plugin that comes back later resumes its
 * choice).
 *
 * @param int $user_id Viewer.
 * @return array<string,string>
 */
function open_station_get_user_file_associations( $user_id ) {
	if ( $user_id <= 0 ) {
		return array();
	}
	$raw = get_user_meta( (int) $user_id, OPEN_STATION_FILE_ASSOCIATIONS_META, true );
	if ( ! is_array( $raw ) ) {
		return array();
	}
	$openers = open_station_get_file_openers();
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
