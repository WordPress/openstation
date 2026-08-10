<?php
/**
 * Electron Adapter — shell asset wiring.
 *
 * One script and one stylesheet, loaded into the OpenStation shell.
 * The script registers the ⋯ menu row through core's public
 * `wp.os.registerWindowAction()` and drives the host bridge; it needs
 * no privileged access and no core patch.
 *
 * ## Load timing matters
 *
 * The bundle depends on the `openstation` handle, so it executes after
 * the shell bundle's IIFE has defined `window.wp.os` but before the
 * shell's own `DOMContentLoaded` boot. That window is exactly what an
 * adapter wants: registries are callable, and anything registered is
 * in place before the first window paints.
 *
 * The stylesheet is only enqueued in solo mode. A shell that is not
 * hosting a freed window has no use for it, and a browser user should
 * not download a stylesheet for a feature they cannot reach.
 *
 * @package OpenStationElectronAdapter
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the adapter's handles.
 */
function openstation_electron_register_assets() {
	$suffix = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$script = 'assets/js/electron-adapter' . $suffix . '.js';
	$path   = OPENSTATION_ELECTRON_DIR . $script;

	wp_register_script(
		'openstation-electron-adapter',
		OPENSTATION_ELECTRON_URL . $script,
		array( 'openstation' ),
		file_exists( $path ) ? (string) filemtime( $path ) : OPENSTATION_ELECTRON_VERSION,
		/*
		 * `strategy => defer` is load-bearing, and matching the
		 * `openstation` handle's own strategy is the whole point.
		 *
		 * Declaring a dependency orders the *tags*, not the
		 * *execution*. The shell bundle is deferred, so it runs after
		 * the document is parsed — while a plain classic script runs
		 * the moment the parser reaches it. Register this one without
		 * `defer` and it executes BEFORE the thing it depends on,
		 * `window.wp.os` does not exist yet, and the adapter gives up:
		 * the app connects, the desktop loads, and the ⋯ menu row is
		 * silently missing with only a console line to say why.
		 *
		 * Deferred scripts run in dependency order, so this is also the
		 * only spelling that actually honours the dependency above.
		 * On WP < 6.3 the array collapses to a truthy `$in_footer`,
		 * exactly as core's own registration does.
		 *
		 * `src/index.ts` additionally waits for `wp.os` rather than
		 * giving up, so a future strategy change cannot resurrect this
		 * bug. Both halves matter: this one makes it correct, that one
		 * makes it survivable.
		 */
		array(
			'in_footer' => true,
			'strategy'  => 'defer',
		)
	);

	$style = 'assets/css/solo-host.css';
	wp_register_style(
		'openstation-electron-solo',
		OPENSTATION_ELECTRON_URL . $style,
		array(),
		file_exists( OPENSTATION_ELECTRON_DIR . $style )
			? (string) filemtime( OPENSTATION_ELECTRON_DIR . $style )
			: OPENSTATION_ELECTRON_VERSION
	);
}
add_action( 'init', 'openstation_electron_register_assets' );

/**
 * Enqueue into the OpenStation shell.
 *
 * Gated on OpenStation being on for this user and the request not
 * being a chromeless iframe — an iframe is window *content*, and the
 * adapter belongs to the shell that owns the windows.
 */
function openstation_electron_enqueue() {
	if ( ! function_exists( 'openstation_is_enabled' ) || ! openstation_is_enabled() ) {
		return;
	}
	if ( function_exists( 'openstation_is_chromeless_request' ) && openstation_is_chromeless_request() ) {
		return;
	}
	if ( function_exists( 'openstation_is_classic_request' ) && openstation_is_classic_request() ) {
		return;
	}

	wp_enqueue_script( 'openstation-electron-adapter' );
	wp_add_inline_script(
		'openstation-electron-adapter',
		'window.openStationElectronConfig = ' . wp_json_encode( openstation_electron_config() ) . ';',
		'before'
	);

	if ( function_exists( 'openstation_is_solo_request' ) && openstation_is_solo_request() ) {
		wp_enqueue_style( 'openstation-electron-solo' );
	}
}
add_action( 'admin_enqueue_scripts', 'openstation_electron_enqueue', 20 );
