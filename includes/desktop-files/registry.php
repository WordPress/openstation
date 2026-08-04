<?php
/**
 * OpenStation — file-type registry.
 *
 * Maps a file-type slug (`'post'`, `'user'`, `'folder'`, …) to the
 * `OpenStation_File` subclass that adapts the underlying entity.
 * Plugins extend the file system by registering their own subclass
 * via {@see openstation_register_file_type()}; the desktop UI then
 * knows how to render and resolve their entities just like the
 * built-in types.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Internal static-store registry. Mirrors the wallpaper / native-
 * window pattern (see `openstation_desktop_wallpaper_registry()`).
 *
 * @internal
 *
 * @param string     $type  File-type slug ('' to fetch the full store).
 * @param array|null $entry Entry to write, or null to read.
 * @return array|null Full store when `$type` is empty; entry when
 *                    looking one up; `null` when not found.
 */
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

/**
 * Registers a desktop file type.
 *
 * @param string $type File-type slug, e.g. `'post'`, `'user'`,
 *                     `'jorvy-quote'`. Must be non-empty and unique.
 * @param array  $args {
 *     @type string   $label   Required. Human label for picker UIs.
 *     @type string   $class   Required. Fully-qualified
 *                             `OpenStation_File` subclass name.
 *     @type string   $script  Optional. Enqueued script handle for the
 *                             plugin's JS-side definition. The shell
 *                             dynamically loads the URL on activation
 *                             so a plugin's file types appear without
 *                             a shell reload.
 *     @type int      $sort    Sort order in picker UIs. Default 100.
 *     @type string[] $capabilities Gate: ALL caps must match.
 * }
 * @return true|WP_Error `true` on success, `WP_Error` otherwise.
 */
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
					/* translators: %s: capability slug. */
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

	/**
	 * Fires after a desktop file type is successfully registered.
	 * Does NOT fire on `WP_Error` returns.
	 *
	 * @param string $type  Type slug.
	 * @param array  $entry Stored registry entry.
	 */
	do_action( 'openstation_file_type_registered', $type, $entry );

	return true;
}

/**
 * Looks up a registered file-type entry.
 *
 * @param string $type Type slug.
 * @return array|null Registry entry, or `null` if unknown.
 */
function openstation_get_file_type( $type ) {
	$entry = openstation_file_type_registry( (string) $type );
	return is_array( $entry ) ? $entry : null;
}

/**
 * Returns every registered file type, sorted by `sort` then label.
 *
 * @return array[]
 */
function openstation_get_file_types() {
	$registry = openstation_file_type_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	/**
	 * Filters the full file-type registry before consumers see it.
	 * Plugins can hide built-in types or swap a class out at runtime.
	 *
	 * @param array[] $registry Registered entries keyed by slug.
	 */
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

/**
 * Resolves a `(type, ref)` tuple into a `OpenStation_File` instance,
 * or `null` if the type is unknown.
 *
 * @param string     $type File-type slug.
 * @param string|int $ref  Entity reference.
 * @return OpenStation_File|null
 */
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

/**
 * Builds the file-types payload sent to the shell. Only metadata
 * (id, label, sort) and the resolved script URL cross the wire —
 * the PHP class never serializes; the JS side has its own mirror.
 *
 * @return array[]
 */
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
		);
	}
	return $out;
}
