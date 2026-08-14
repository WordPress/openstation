<?php
/**
 * OpenStation — Wallpapers registry.
 *
 * Server-side registration API + payload builder + asset enqueue
 * for the desktop wallpaper picker. Wallpaper definitions live
 * on `window.openStationWallpapers[ id ]` (set by the plugin's
 * own JS); this module is the PHP side that announces them to
 * the shell and ships their script handles into the boot
 * payload.
 *
 * Extracted from `components.php` during the architecture-0.8.1
 * PHP slicing (phase 6). Behaviour, function names, filter
 * contracts, and error codes all unchanged.
 *
 * @package OpenStation
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register a server-side desktop wallpaper. Symmetrical to
 * {@see openstation_register_widget()}. The plugin's JS side
 * publishes the full `WallpaperDef` (with mount / resolveValue /
 * renderEditor callbacks as appropriate) on
 * `window.openStationWallpapers[ <id> ]`; the shell loads the
 * declared script, reads that global, and registers the def via
 * the normal wallpaper registry. Deactivation unregisters the
 * def and re-applies the current selection (which falls back to
 * a built-in if the user's active wallpaper was the one leaving).
 *
 * Example:
 *
 * ```php
 * openstation_register_wallpaper( 'myplugin/snow', array(
 *     'label'   => __( 'Snow', 'my-plugin' ),
 *     'preview' => 'linear-gradient(#fff, #ddd)',
 *     'type'    => 'canvas',
 *     'script'  => 'my-plugin-snow-wallpaper',
 * ) );
 * ```
 *
 * ```js
 * // Inside my-plugin-snow-wallpaper.js
 * window.openStationWallpapers = window.openStationWallpapers || {};
 * window.openStationWallpapers[ 'myplugin/snow' ] = {
 *     id: 'myplugin/snow',
 *     label: 'Snow',
 *     type: 'canvas',
 *     preview: 'linear-gradient(#fff, #ddd)',
 *     needs: [ 'pixijs' ],
 *     mount: function ( container, ctx ) { return function () {}; },
 * };
 * ```
 *
 * @param string $id   Wallpaper id. For canvas wallpapers this must
 *                     match the `window.openStationWallpapers[<id>]`
 *                     key the plugin's JS publishes.
 * @param array  $args {
 *     @type string   $label        Picker label. Required.
 *     @type string   $preview      CSS value rendered in the picker
 *                                  swatch (gradient, color,
 *                                  `url(...)`, etc.). Required.
 *     @type string   $type         'css' | 'canvas'. Default 'canvas'.
 *     @type string   $value        CSS value applied to the wallpaper
 *                                  surface (only relevant for `css`
 *                                  type — canvas wallpapers paint in
 *                                  JS). Defaults to `preview` so a
 *                                  single string covers the common
 *                                  case where swatch and surface are
 *                                  identical.
 *     @type string   $script       Enqueued script handle that
 *                                  publishes the def on the global.
 *                                  Required for `canvas` type;
 *                                  optional for `css`.
 *     @type string   $description  Plain-text description shown in OS
 *                                  Settings when the wallpaper is the
 *                                  active selection — what it is, where
 *                                  its data comes from, the story behind
 *                                  it. Optional.
 *     @type string[] $capabilities Gate: ALL caps must match. Any
 *                                  missed cap returns
 *                                  `WP_Error openstation_capability_denied`.
 * }
 * @return true|WP_Error `true` on success; `WP_Error` otherwise.
 */
function openstation_register_wallpaper( $id, $args = array() ) {
	$id = (string) $id;
	if ( '' === $id ) {
		return openstation_registration_error(
			'openstation_missing_id',
			__( 'Wallpaper id is required.', 'desktop-mode' )
		);
	}

	$defaults = array(
		'label'        => '',
		'preview'      => '',
		'type'         => 'canvas',
		'value'        => '',
		'script'       => '',
		'description'  => '',
		'capabilities' => array(),
	);
	$args     = wp_parse_args( $args, $defaults );

	foreach ( (array) $args['capabilities'] as $cap ) {
		if ( ! current_user_can( (string) $cap ) ) {
			return openstation_registration_error(
				'openstation_capability_denied',
				sprintf(
					/* translators: %s: capability slug. */
					__( 'Current user lacks the %s capability required to register this wallpaper.', 'desktop-mode' ),
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
			__( 'Wallpaper registration requires a non-empty `label`.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}
	$type = in_array( $args['type'], array( 'css', 'canvas' ), true )
		? $args['type']
		: 'canvas';
	// Canvas wallpapers always need a script (the def with its
	// `mount` callback is published on the JS global by that
	// script). CSS wallpapers can skip the script — the shell can
	// render from the `value` / `preview` string alone.
	if ( 'canvas' === $type && '' === (string) $args['script'] ) {
		return openstation_registration_error(
			'openstation_missing_script',
			__( 'Canvas wallpaper registration requires a `script` handle that publishes the def.', 'desktop-mode' ),
			array( 'id' => $id )
		);
	}

	// `value` defaults to `preview` when omitted — the common case
	// for a plain gradient/solid where the swatch and the surface
	// render the same CSS. Authors can split them (e.g. static
	// swatch preview + animated value) by passing both.
	$value = (string) $args['value'];
	if ( '' === $value ) {
		$value = (string) $args['preview'];
	}

	$entry = array(
		'id'          => $id,
		// Plain text by contract, same as `description` below. The
		// shell paints labels through the `html` tagged template, whose
		// text slots build DOM with `createTextNode()` — never
		// `innerHTML` — so a label cannot become markup downstream.
		//
		// Note this STRIPS rather than ESCAPES, and that distinction is
		// load-bearing: `esc_html()` here would encode `&` in a
		// perfectly ordinary label ("Black & White") and the text node
		// would then render the entity literally as `&amp;`. Escaping
		// belongs at an HTML boundary; there isn't one on this path.
		'label'       => sanitize_text_field( (string) $args['label'] ),
		'preview'     => (string) $args['preview'],
		'type'        => $type,
		'value'       => $value,
		'script'      => (string) $args['script'],
		// Plain text by contract — the shell renders it as text, never
		// as HTML, so strip tags here rather than trusting every caller.
		'description' => sanitize_textarea_field( (string) $args['description'] ),
	);
	openstation_desktop_wallpaper_registry( $id, $entry );

	/**
	 * Fires after a desktop wallpaper is successfully registered.
	 *
	 * Does NOT fire when `openstation_register_wallpaper()` returns a
	 * `WP_Error`.
	 *
	 * @param string $id    The wallpaper id.
	 * @param array  $entry The stored registry entry.
	 */
	do_action( 'openstation_wallpaper_registered', $id, $entry );

	return true;
}

/**
 * Internal module-level registry for wallpapers registered via
 * {@see openstation_register_wallpaper()}. Same static-store
 * pattern as the widget + native-window registries.
 *
 * @internal
 */
function openstation_desktop_wallpaper_registry( $id = '', $entry = null ) {
	static $store = array();

	if ( '' === (string) $id ) {
		return $store;
	}
	if ( null !== $entry ) {
		$store[ $id ] = $entry;
	}
	return isset( $store[ $id ] ) ? $store[ $id ] : null;
}

/**
 * Build the wallpaper list for the shell payload. Only metadata +
 * the resolved script URL cross the wire; the plugin's mount
 * callback is announced via the JS global the script sets up.
 *
 * @return array[]
 */
function openstation_build_desktop_wallpapers_payload() {
	$registry = openstation_desktop_wallpaper_registry();
	if ( ! is_array( $registry ) || empty( $registry ) ) {
		return array();
	}
	/**
	 * Filters the server-declared wallpaper list before it ships to
	 * the shell. Mirrors the JS-side `os.wallpapers` filter
	 * so plugins can rearrange, hide, or override entries at boot
	 * without round-tripping through the JS registry.
	 *
	 * @param array[] $registry The registered wallpaper entries.
	 */
	$registry = apply_filters( 'openstation_wallpapers', $registry );
	if ( ! is_array( $registry ) ) {
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
			'label'              => isset( $entry['label'] ) ? (string) $entry['label'] : '',
			'preview'            => isset( $entry['preview'] ) ? (string) $entry['preview'] : '',
			'type'               => isset( $entry['type'] ) ? (string) $entry['type'] : 'canvas',
			'value'              => isset( $entry['value'] ) ? (string) $entry['value'] : '',
			'description'        => isset( $entry['description'] ) ? (string) $entry['description'] : '',
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


/*
 * Wallpaper scripts are NOT enqueued here, and that is deliberate.
 *
 * A canvas wallpaper's bundle IS the wallpaper — Living Tree is 58 KB
 * of PixiJS scene, Snow is 42 KB — and this file used to
 * `wp_enqueue_script()` every registered one on every admin page, so
 * that every user downloaded and parsed every wallpaper in the
 * install including the ones they were not wearing. The metadata in
 * the boot payload (label, preview swatch, description) is enough for
 * the shell to register a stub and paint a picker tile without any of
 * it.
 *
 * The bundle arrives when something needs the callbacks: the shell
 * hydrates the user's ACTIVE wallpaper during the boot sync, and the
 * wallpaper picker hydrates the rest when it opens. See
 * `src/wallpapers/lazy.ts`. `scriptUrl` in the payload (built above)
 * is what makes that possible; nothing else on the PHP side is
 * involved.
 */
