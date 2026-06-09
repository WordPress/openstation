<?php
/**
 * Desktop Mode — Wapuu widget (built-in, lazy-loaded).
 *
 * A pocket Wapuu pet that lives on the desktop: he breathes, blinks,
 * follows the cursor, wags his tail, wanders, dozes off when ignored,
 * and can be grabbed and tossed. Built on PixiJS v8.
 *
 * Dogfoods the public `desktop_mode_register_widget()` API: the
 * metadata + script handle live here, the JS + CSS ship as their own
 * Vite bundle (`assets/js/widget-wapuu[.min].js` and matching `.css`).
 * The shell's widgets `server-sync` only loads them when the user adds
 * the widget or the picker is opened — the main bundle keeps none of
 * Wapuu's (or PixiJS's) code.
 *
 * @package WPDesktopMode
 * @since   0.19.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS bundle as a script handle so it can be loaded
 * lazily, plus the CSS file Vite emits alongside it.
 *
 * @since 0.19.0
 */
function desktop_mode_register_wapuu_widget_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path  = DESKTOP_MODE_DIR . 'assets/js/widget-wapuu' . $suffix . '.js';
	$css_path = DESKTOP_MODE_DIR . 'assets/js/widget-wapuu' . $suffix . '.css';

	wp_register_style(
		'desktop-mode-wapuu-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-wapuu' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);
	wp_register_script(
		'desktop-mode-wapuu-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-wapuu' . $suffix . '.js',
		array( 'wp-hooks' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'desktop_mode_register_wapuu_widget_assets', 5 );

/**
 * Register the widget itself. Sizing constraints + chrome metadata
 * (label / description / icon) live here so the framework knows the
 * widget exists at picker-render time, before the JS bundle is even
 * fetched.
 *
 * `movable` is `true` so the WHOLE widget can be dragged across the
 * desktop (and lifted out of the right-side column). The widget's CSS
 * strips the chrome header down to an unobtrusive, mostly-invisible
 * drag strip so it still reads as "just the pet"; Wapuu leans + pins
 * his ears as the widget is carried. Clicking Wapuu himself pets him —
 * he no longer drags inside the card and never moves horizontally.
 *
 * @since 0.19.0
 */
function desktop_mode_register_wapuu_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}
	desktop_mode_register_widget( 'desktop-mode/wapuu', array(
		'label'          => __( 'Wapuu', 'desktop-mode' ),
		'description'    => __(
			'A pocket Wapuu who follows your cursor, hops in place, and naps when ignored. Drag the widget to carry him around.',
			'desktop-mode'
		),
		'icon'           => 'dashicons-pets',
		'script'         => 'desktop-mode-wapuu-widget',
		'movable'        => true,
		// Not resizable: the whole card is a transparent drag overlay
		// (drag Wapuu from anywhere), and edge resize handles would fight
		// that overlay for the card's border pixels. Fixed size keeps the
		// interaction unambiguous and the brief — "just the pet" — clean.
		'resizable'      => false,
		'default_width'  => 300,
		'default_height' => 340,
	) );
}
add_action( 'init', 'desktop_mode_register_wapuu_widget', 6 );

/**
 * Eagerly enqueue the widget's CSS handle ONLY on a Desktop Mode SHELL
 * request — not a chromeless iframe, not a non-shell admin page. The JS
 * bundle stays lazy and loads via the widget server-sync the first time
 * the picker opens or the widget mounts. Mirrors the heartbeat widget's
 * eager-CSS rationale (avoid a flash of unstyled card chrome).
 *
 * @since 0.19.0
 */
function desktop_mode_enqueue_wapuu_widget_styles() {
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return;
	}
	if (
		function_exists( 'desktop_mode_is_chromeless_request' )
		&& desktop_mode_is_chromeless_request()
	) {
		return;
	}
	/**
	 * Whether to enqueue the Wapuu widget's stylesheet on this request.
	 * Defaults to `true` for shell requests in Desktop Mode.
	 *
	 * @since 0.19.0
	 *
	 * @param bool $eager Default `true` once the chromeless +
	 *                    desktop-mode gates above have passed.
	 */
	$eager = (bool) apply_filters( 'desktop_mode_wapuu_widget_eager_css', true );
	if ( ! $eager ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-wapuu-widget' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_wapuu_widget_styles', 20 );
