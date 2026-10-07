<?php

defined( 'ABSPATH' ) || exit;

function openstation_register_window_theme_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window theme script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_theme_script_registry( $handle, true );

	do_action( 'openstation_window_theme_script_registered', $handle );

	return true;
}

function openstation_register_window_theme( $args = array() ) {
	$defaults = array(
		'id'       => '',
		'label'    => '',
		'tokens'   => array(),
		'priority' => 100,
		'script'   => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Window theme registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}
	if ( ! is_array( $args['tokens'] ) || empty( $args['tokens'] ) ) {
		return openstation_registration_error(
			'openstation_missing_tokens',
			__( 'Window theme registration requires a non-empty `tokens` map.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	$tokens = array();
	foreach ( $args['tokens'] as $key => $value ) {
		$key = (string) $key;
		if ( '' === $key || 0 !== strpos( $key, '--' ) ) {
			return openstation_registration_error(
				'openstation_invalid_token',
				__( 'Window theme tokens must use CSS custom-property keys (start with "--").', 'desktop-mode' ),
				array(
					'id'  => $id,
					'key' => $key,
				)
			);
		}
		$tokens[ $key ] = (string) $value;
	}

	$entry = array(
		'id'       => $id,
		'label'    => (string) $args['label'],
		'tokens'   => $tokens,
		'priority' => (int) $args['priority'],
		'script'   => (string) $args['script'],
	);
	openstation_window_theme_registry( $id, $entry );

	if ( '' !== $entry['script'] ) {
		openstation_window_theme_script_registry( $entry['script'], true );
	}

	do_action( 'openstation_window_theme_registered', $id, $entry );

	return true;
}

function openstation_window_theme_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

function openstation_flush_window_theme_script_registry() {
	openstation_window_theme_script_registry( '__flush__' );
}

function openstation_window_theme_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '__flush__' === (string) $id ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

function openstation_flush_window_theme_registry() {
	openstation_window_theme_registry( '__flush__' );
}

function openstation_build_window_theme_scripts_payload() {
	$registry = openstation_window_theme_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			openstation_warn_unresolvable_script_handle(
				'openstation_register_window_theme_script',
				'Window theme',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $handle ),
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

function openstation_build_window_themes_payload() {
	$registry = openstation_window_theme_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$handle  = (string) $entry['script'];
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
			'tokens'             => (array) $entry['tokens'],
			'priority'           => (int) $entry['priority'],
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

function openstation_register_window_control_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window control script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_control_script_registry( $handle, true );

	do_action( 'openstation_window_control_script_registered', $handle );

	return true;
}

function openstation_register_window_control( $args = array() ) {
	$defaults = array(
		'id'        => '',
		'label'     => '',
		'icon'      => '',
		'placement' => 'left',
		'order'     => 100,
		'script'    => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Window control registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}
	if ( '' === (string) $args['label'] ) {
		return openstation_registration_error(
			'openstation_missing_label',
			__( 'Window control registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	$placement = (string) $args['placement'];
	if ( ! in_array( $placement, array( 'left', 'right', 'controls' ), true ) ) {
		return openstation_registration_error(
			'openstation_invalid_placement',
			__( 'Window control `placement` must be one of "left", "right", "controls".', 'desktop-mode' ),
			array(
				'id'        => $id,
				'placement' => $placement,
			)
		);
	}

	$entry = array(
		'id'        => $id,
		'label'     => (string) $args['label'],
		'icon'      => (string) $args['icon'],
		'placement' => $placement,
		'order'     => (int) $args['order'],
		'script'    => (string) $args['script'],
	);
	openstation_window_control_registry( $id, $entry );

	if ( '' !== $entry['script'] ) {
		openstation_window_control_script_registry( $entry['script'], true );
	}

	do_action( 'openstation_window_control_registered', $id, $entry );

	return true;
}

function openstation_window_control_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

function openstation_flush_window_control_script_registry() {
	openstation_window_control_script_registry( '__flush__' );
}

function openstation_window_control_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '__flush__' === (string) $id ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

function openstation_flush_window_control_registry() {
	openstation_window_control_registry( '__flush__' );
}

function openstation_build_window_control_scripts_payload() {
	$registry = openstation_window_control_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			openstation_warn_unresolvable_script_handle(
				'openstation_register_window_control_script',
				'Window control',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $handle ),
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

function openstation_build_window_controls_payload() {
	$registry = openstation_window_control_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$handle  = (string) $entry['script'];
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
			'icon'               => (string) $entry['icon'],
			'placement'          => (string) $entry['placement'],
			'order'              => (int) $entry['order'],
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

function openstation_window_slot_names() {
	return array(
		'before-titlebar',
		'before-icon',
		'icon',
		'title',
		'after-title',
		'before-controls',
		'controls',
		'after-controls',
		'after-titlebar',
	);
}

function openstation_register_window_slot_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window slot script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_slot_script_registry( $handle, true );

	do_action( 'openstation_window_slot_script_registered', $handle );

	return true;
}

function openstation_register_window_slot( $args = array() ) {
	$defaults = array(
		'id'     => '',
		'slot'   => '',
		'order'  => 100,
		'script' => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Window slot registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}
	$slot = (string) $args['slot'];
	if ( ! in_array( $slot, openstation_window_slot_names(), true ) ) {
		return openstation_registration_error(
			'openstation_invalid_slot',
			__( 'Window slot registration requires a known `slot` name.', 'desktop-mode' ),
			array(
				'id'   => $id,
				'slot' => $slot,
			)
		);
	}

	$entry = array(
		'id'     => $id,
		'slot'   => $slot,
		'order'  => (int) $args['order'],
		'script' => (string) $args['script'],
	);
	openstation_window_slot_registry( $id, $entry );

	if ( '' !== $entry['script'] ) {
		openstation_window_slot_script_registry( $entry['script'], true );
	}

	do_action( 'openstation_window_slot_registered', $id, $entry );

	return true;
}

function openstation_window_slot_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

function openstation_flush_window_slot_script_registry() {
	openstation_window_slot_script_registry( '__flush__' );
}

function openstation_window_slot_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '__flush__' === (string) $id ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

function openstation_flush_window_slot_registry() {
	openstation_window_slot_registry( '__flush__' );
}

function openstation_build_window_slot_scripts_payload() {
	$registry = openstation_window_slot_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			openstation_warn_unresolvable_script_handle(
				'openstation_register_window_slot_script',
				'Window slot',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $handle ),
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

function openstation_build_window_slots_payload() {
	$registry = openstation_window_slot_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$handle  = (string) $entry['script'];
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
			'slot'               => (string) $entry['slot'],
			'order'              => (int) $entry['order'],
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

function openstation_register_window_chrome_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window chrome script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_chrome_script_registry( $handle, true );

	do_action( 'openstation_window_chrome_script_registered', $handle );

	return true;
}

function openstation_register_window_chrome( $args = array() ) {
	$defaults = array(
		'id'     => '',
		'label'  => '',
		'script' => '',
	);
	$args     = wp_parse_args( $args, $defaults );

	$id = (string) $args['id'];
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Window chrome registration requires a non-empty `id`.', 'desktop-mode' )
		);
	}

	$entry = array(
		'id'     => $id,
		'label'  => (string) $args['label'],
		'script' => (string) $args['script'],
	);
	openstation_window_chrome_registry( $id, $entry );

	if ( '' !== $entry['script'] ) {
		openstation_window_chrome_script_registry( $entry['script'], true );
	}

	do_action( 'openstation_window_chrome_registered', $id, $entry );

	return true;
}

function openstation_window_chrome_script_registry( $handle = '', $value = null ) {
	static $store = array();

	if ( '__flush__' === (string) $handle ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $handle ) {
		return $store;
	}
	if ( null !== $value ) {
		$store[ (string) $handle ] = (bool) $value;
	}
	return isset( $store[ (string) $handle ] ) ? $store[ (string) $handle ] : false;
}

function openstation_flush_window_chrome_script_registry() {
	openstation_window_chrome_script_registry( '__flush__' );
}

function openstation_window_chrome_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '__flush__' === (string) $id ) {
		$store = array();
		return array();
	}
	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ (string) $id ] = $entry;
	}
	return isset( $store[ (string) $id ] ) ? $store[ (string) $id ] : null;
}

function openstation_flush_window_chrome_registry() {
	openstation_window_chrome_registry( '__flush__' );
}

function openstation_build_window_chrome_scripts_payload() {
	$registry = openstation_window_chrome_script_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out  = array();
	$seen = array();
	foreach ( $registry as $handle => $active ) {
		if ( ! $active || isset( $seen[ $handle ] ) ) {
			continue;
		}
		$payload = openstation_resolve_script_payload( $handle );
		if ( '' === $payload['url'] ) {
			openstation_warn_unresolvable_script_handle(
				'openstation_register_window_chrome_script',
				'Window chrome',
				(string) $handle
			);
			continue;
		}
		$out[]           = array(
			'handle'             => (string) $handle,
			'scriptUrl'          => $payload['url'],
			'scriptBefore'       => $payload['before'],
			'scriptAfter'        => $payload['after'],
			'scriptL10n'         => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],

			'scriptDeps'         => openstation_resolve_script_dependencies( $handle ),
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

function openstation_build_window_chromes_payload() {
	$registry = openstation_window_chrome_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}

	$out = array();
	foreach ( $registry as $entry ) {
		$handle  = (string) $entry['script'];
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
