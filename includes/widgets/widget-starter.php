<?php
/**
 * Desktop Mode — Starter Widget (skeleton / how-to template).
 *
 * A heavily commented reference implementation showing every step
 * needed to build a Desktop Mode widget. Intended for plugin authors
 * learning the widget API.
 *
 * Requires: Desktop Mode 0.18.0+ (desktop_mode_register_widget).
 *
 * @package WPDesktopMode
 * @since   0.26.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Step 1: Register your script and style handles.
 *
 * Use wp_register_script() not wp_enqueue_script() — the shell's
 * server-sync loads the bundle lazily when the widget mounts.
 * wp_register_style() is for the CSS that loads eagerly on shell pages
 * to avoid a flash of unstyled content.
 *
 * File naming convention:
 *   assets/js/widget-{name}.js      — development build (SCRIPT_DEBUG)
 *   assets/js/widget-{name}.min.js  — production build (default)
 *   assets/js/widget-{name}.css     — unminified styles
 *   assets/js/widget-{name}.min.css — minified styles (default)
 */
function desktop_mode_register_starter_widget_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path  = DESKTOP_MODE_DIR . 'assets/js/widget-starter' . $suffix . '.js';
	$css_path = DESKTOP_MODE_DIR . 'assets/js/widget-starter' . $suffix . '.css';

	wp_register_style(
		'desktop-mode-starter-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-starter' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'desktop-mode-starter-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-starter' . $suffix . '.js',
		// Declare script dependencies here. wp-api-fetch is available
		// on every admin page and handles REST nonces automatically.
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true // Load in footer.
	);
}
add_action( 'init', 'desktop_mode_register_starter_widget_assets', 5 );

/**
 * Step 2: Eagerly enqueue the CSS on shell pages.
 *
 * The JS bundle loads lazily (only when the widget mounts or the
 * picker opens) but the CSS needs to be in the DOM first to prevent
 * a flash of unstyled content on first render.
 */
function desktop_mode_enqueue_starter_widget_styles() {
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-starter-widget' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_starter_widget_styles', 20 );

/**
 * Step 3: Register the widget definition.
 *
 * This tells Desktop Mode the widget exists, what it looks like in
 * the picker, which script handle to load, and its size constraints.
 *
 * Key args:
 *   label          Human-readable name shown in the picker.
 *   description    One-liner shown beneath the label in the picker.
 *   icon           Any dashicons class name.
 *   script         The wp_register_script() handle from Step 1.
 *   movable        true = user can drag it off the column.
 *   resizable      true = user can resize it (needs movable: true for
 *                  all 8 resize handles; column-docked gets bottom only).
 *   min_width/height  Smallest the user can shrink the card.
 *   default_width/height  Starting size when first added floating.
 */
function desktop_mode_register_starter_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}
	desktop_mode_register_widget(
		// Widget id — must match the WIDGET_ID constant in your JS file.
		'desktop-mode/starter',
		array(
			'label'          => __( 'Starter Widget', 'desktop-mode' ),
			'description'    => __( 'A skeleton widget — copy this to build your own.', 'desktop-mode' ),
			'icon'           => 'dashicons-welcome-widgets-menus',
			'script'         => 'desktop-mode-starter-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 200,
			'min_height'     => 140,
			'default_width'  => 280,
			'default_height' => 200,
		)
	);
}
add_action( 'init', 'desktop_mode_register_starter_widget', 6 );
