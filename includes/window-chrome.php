<?php
/**
 * Window-chrome customization framework — server-side registration APIs.
 *
 * Mirrors the commands / settings-tabs / title-bar-buttons registration
 * pattern across four surfaces:
 *
 *   - **Themes** (Layer 1) — per-window CSS-variable maps.
 *     `openstation_register_window_theme_script()` /
 *     `openstation_register_window_theme()`.
 *
 *   - **Controls** (Layer 2) — title-bar buttons (close / minimize /
 *     maximize plus plugin custom controls).
 *     `openstation_register_window_control_script()` /
 *     `openstation_register_window_control()`.
 *
 *   - **Slots** (Layer 3) — named title-bar regions plugins can
 *     replace (icon, title, before-controls, …).
 *     `openstation_register_window_slot_script()` /
 *     `openstation_register_window_slot()`.
 *
 *   - **Chrome** (Layer 4, Experimental) — full title-bar render
 *     replacement.
 *     `openstation_register_window_chrome_script()` /
 *     `openstation_register_window_chrome()`.
 *
 * Each surface contributes a `serverWindow*Scripts` and (optionally)
 * `serverWindow*` array to the shell payload, consumed by the matching
 * sync module under `src/window-chrome/{themes,controls,slots,chrome}/server-sync.ts`.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/* ============================================================
 * Layer 1 — Themes
 * ============================================================ */

/**
 * Declare a WP-registered script handle as a window-theme provider.
 *
 * The script's JS calls `wp.os.registerWindowTheme( { id, tokens,
 * match, owner } )` as usual. Plugins that pass `owner` matching this
 * handle get live unregister on deactivation.
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error `true` on success; `WP_Error` on validation failure.
 */
function openstation_register_window_theme_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window theme script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_theme_script_registry( $handle, true );

	/**
	 * Fires after a desktop window-theme script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_window_theme_script_registered', $handle );

	return true;
}

/**
 * Declare a window theme server-side. Optional companion to
 * `openstation_register_window_theme_script()` for plugins that want
 * to ship a tokens map without writing JS — designers can hand off
 * a single PHP-array of CSS variables and call it done.
 *
 * @param array $args {
 *     @type string $id       Unique theme id (`vendor/sub-id`). Required.
 *     @type string $label    Human-readable label. Default empty.
 *     @type array  $tokens   CSS-variable map (keys must start with `--`). Required.
 *     @type int    $priority Override priority (higher wins). Default 100.
 *     @type string $script   Optional script handle (also registers it).
 * }
 * @return true|WP_Error
 */
function openstation_register_window_theme( $args = array() ) {
	$defaults = array(
		'id'       => '',
		'label'    => '',
		'tokens'   => array(),
		'priority' => 100,
		'script'   => '',
	);
	$args = wp_parse_args( $args, $defaults );

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

	/**
	 * Fires after a desktop window-theme is successfully registered.
	 *
	 * @param string $id    The theme id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_window_theme_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for theme script handles.
 *
 * @internal
 *
 * @param string    $handle Script handle to read or write.
 * @param bool|null $value  Pass `true` to register; `null` to read only.
 * @return array|bool When called with no args returns the full store.
 */
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

/** Flush the theme-script registry. Tests only. */
function openstation_flush_window_theme_script_registry() {
	openstation_window_theme_script_registry( '__flush__' );
}

/**
 * Internal module-level registry for window themes.
 *
 * @internal
 *
 * @param string     $id    Theme id to read or write.
 * @param array|null $entry Entry to store, or `null` to read.
 * @return array|null
 */
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

/** Flush the theme registry. Tests only. */
function openstation_flush_window_theme_registry() {
	openstation_window_theme_registry( '__flush__' );
}

/**
 * Build the theme-script payload. Same shape as
 * `openstation_build_desktop_command_scripts_payload()`.
 *
 * @return array[] List of `{ handle, scriptUrl }` entries.
 */
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
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

/**
 * Build the theme-metadata payload. Resolves the optional companion
 * script handle for each entry.
 *
 * @return array[]
 */
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
			: array( 'url' => '', 'before' => array(), 'after' => array(), 'l10n' => array(), 'translations' => '' );
		$out[]  = array(
			'id'                => (string) $entry['id'],
			'label'             => (string) $entry['label'],
			'tokens'            => (array) $entry['tokens'],
			'priority'          => (int) $entry['priority'],
			'scriptUrl'         => $payload['url'],
			'scriptHandle'      => $handle,
			'scriptBefore'      => $payload['before'],
			'scriptAfter'       => $payload['after'],
			'scriptL10n'        => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}

/* ============================================================
 * Layer 2 — Controls
 * ============================================================ */

/**
 * Declare a WP-registered script handle as a window-control provider.
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error
 */
function openstation_register_window_control_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window control script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_control_script_registry( $handle, true );

	/**
	 * Fires after a window-control script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_window_control_script_registered', $handle );

	return true;
}

/**
 * Declare a window control server-side. The control's `onClick` /
 * `render` callback always lives JS-side.
 *
 * @param array $args {
 *     @type string $id        Required, `vendor/sub-id`.
 *     @type string $label     Required.
 *     @type string $icon      Dashicons class / built-in key / SVG.
 *     @type string $placement `'left' | 'right' | 'controls'`. Default `'left'`.
 *     @type int    $order     Sort within placement. Default 100.
 *     @type string $script    Optional companion script handle.
 * }
 * @return true|WP_Error
 */
function openstation_register_window_control( $args = array() ) {
	$defaults = array(
		'id'        => '',
		'label'     => '',
		'icon'      => '',
		'placement' => 'left',
		'order'     => 100,
		'script'    => '',
	);
	$args = wp_parse_args( $args, $defaults );

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

	/**
	 * Fires after a window-control is successfully registered.
	 *
	 * @param string $id    The control id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_window_control_registered', $id, $entry );

	return true;
}

/** @internal */
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

/** Tests only. */
function openstation_flush_window_control_script_registry() {
	openstation_window_control_script_registry( '__flush__' );
}

/** @internal */
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

/** Tests only. */
function openstation_flush_window_control_registry() {
	openstation_window_control_registry( '__flush__' );
}

/**
 * @return array[] List of `{ handle, scriptUrl }` entries.
 */
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
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

/**
 * @return array[]
 */
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
			: array( 'url' => '', 'before' => array(), 'after' => array(), 'l10n' => array(), 'translations' => '' );
		$out[]  = array(
			'id'                => (string) $entry['id'],
			'label'             => (string) $entry['label'],
			'icon'              => (string) $entry['icon'],
			'placement'         => (string) $entry['placement'],
			'order'             => (int) $entry['order'],
			'scriptUrl'         => $payload['url'],
			'scriptHandle'      => $handle,
			'scriptBefore'      => $payload['before'],
			'scriptAfter'       => $payload['after'],
			'scriptL10n'        => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}

/* ============================================================
 * Layer 3 — Slots
 * ============================================================ */

/**
 * Canonical slot names. Mirrors the `WindowSlotName` TypeScript
 * union in `src/types.ts`.
 *
 * @return string[]
 */
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

/**
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error
 */
function openstation_register_window_slot_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window slot script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_slot_script_registry( $handle, true );

	/**
	 * Fires after a window-slot script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_window_slot_script_registered', $handle );

	return true;
}

/**
 * @param array $args {
 *     @type string $id     Required.
 *     @type string $slot   Required, one of {@see openstation_window_slot_names()}.
 *     @type int    $order  Default 100.
 *     @type string $script Optional script handle.
 * }
 * @return true|WP_Error
 */
function openstation_register_window_slot( $args = array() ) {
	$defaults = array(
		'id'     => '',
		'slot'   => '',
		'order'  => 100,
		'script' => '',
	);
	$args = wp_parse_args( $args, $defaults );

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

	/**
	 * Fires after a window-slot is successfully registered.
	 *
	 * @param string $id    The slot-renderer id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_window_slot_registered', $id, $entry );

	return true;
}

/** @internal */
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

/** Tests only. */
function openstation_flush_window_slot_script_registry() {
	openstation_window_slot_script_registry( '__flush__' );
}

/** @internal */
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

/** Tests only. */
function openstation_flush_window_slot_registry() {
	openstation_window_slot_registry( '__flush__' );
}

/**
 * @return array[] List of `{ handle, scriptUrl }` entries.
 */
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
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

/**
 * @return array[]
 */
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
			: array( 'url' => '', 'before' => array(), 'after' => array(), 'l10n' => array(), 'translations' => '' );
		$out[]  = array(
			'id'                => (string) $entry['id'],
			'slot'              => (string) $entry['slot'],
			'order'             => (int) $entry['order'],
			'scriptUrl'         => $payload['url'],
			'scriptHandle'      => $handle,
			'scriptBefore'      => $payload['before'],
			'scriptAfter'       => $payload['after'],
			'scriptL10n'        => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}

/* ============================================================
 * Layer 4 — Custom chrome (Experimental)
 * ============================================================ */

/**
 * Declare a WP-registered script handle as a window-chrome provider.
 *
 * **Experimental** — chrome render contract may change.
 *
 * @param string $handle WP-registered script handle.
 * @return true|WP_Error
 */
function openstation_register_window_chrome_script( $handle ) {
	$handle = (string) $handle;
	if ( '' === $handle ) {
		return openstation_registration_error(
			'openstation_missing_handle',
			__( 'Window chrome script registration requires a non-empty script handle.', 'desktop-mode' )
		);
	}

	openstation_window_chrome_script_registry( $handle, true );

	/**
	 * Fires after a window-chrome script handle is registered.
	 *
	 * @param string $handle The registered script handle.
	 */
	do_action( 'openstation_window_chrome_script_registered', $handle );

	return true;
}

/**
 * Declare a custom chrome server-side. **Experimental** — chrome
 * render contract may change.
 *
 * @param array $args {
 *     @type string $id     Required.
 *     @type string $label  Default empty.
 *     @type string $script Optional script handle.
 * }
 * @return true|WP_Error
 */
function openstation_register_window_chrome( $args = array() ) {
	$defaults = array(
		'id'     => '',
		'label'  => '',
		'script' => '',
	);
	$args = wp_parse_args( $args, $defaults );

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

	/**
	 * Fires after a window-chrome is successfully registered.
	 *
	 * @param string $id    The chrome id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_window_chrome_registered', $id, $entry );

	return true;
}

/** @internal */
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

/** Tests only. */
function openstation_flush_window_chrome_script_registry() {
	openstation_window_chrome_script_registry( '__flush__' );
}

/** @internal */
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

/** Tests only. */
function openstation_flush_window_chrome_registry() {
	openstation_window_chrome_registry( '__flush__' );
}

/**
 * @return array[] List of `{ handle, scriptUrl }` entries.
 */
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
		);
		$seen[ $handle ] = true;
	}
	return $out;
}

/**
 * @return array[]
 */
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
			: array( 'url' => '', 'before' => array(), 'after' => array(), 'l10n' => array(), 'translations' => '' );
		$out[]  = array(
			'id'                => (string) $entry['id'],
			'label'             => (string) $entry['label'],
			'scriptUrl'         => $payload['url'],
			'scriptHandle'      => $handle,
			'scriptBefore'      => $payload['before'],
			'scriptAfter'       => $payload['after'],
			'scriptL10n'        => $payload['l10n'],
			'scriptTranslations' => $payload['translations'],
		);
	}
	return $out;
}
