<?php
/**
 * Desktop Mode — Heartbeat widget (built-in, lazy-loaded).
 *
 * Dogfoods the public `desktop_mode_register_widget()` API for a
 * built-in widget: the metadata + script handle live here, the
 * JS + CSS ship as their own Vite bundle
 * (`assets/js/widget-heartbeat[.min].js` and matching `.css`).
 * The shell's widgets `server-sync` only loads them when the user
 * adds the widget or the picker is opened — main bundle keeps
 * none of the heart's code.
 *
 * @package WPDesktopMode
 * @since   0.18.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS bundle as a script handle so it can be loaded
 * lazily via `wp_register_script()` / its URL. The CSS file
 * emitted by Vite alongside the JS gets enqueued as a stylesheet
 * dependency so the chrome always paints with the JS.
 *
 * @since 0.18.0
 */
function desktop_mode_register_heartbeat_widget_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path  = DESKTOP_MODE_DIR . 'assets/js/widget-heartbeat' . $suffix . '.js';
	$css_path = DESKTOP_MODE_DIR . 'assets/js/widget-heartbeat' . $suffix . '.css';

	wp_register_style(
		'desktop-mode-heartbeat-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-heartbeat' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);
	wp_register_script(
		'desktop-mode-heartbeat-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-heartbeat' . $suffix . '.js',
		array( 'wp-hooks' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'desktop_mode_register_heartbeat_widget_assets', 5 );

/**
 * Register the widget itself. Sizing constraints + chrome metadata
 * (label / description / icon) live here so the framework knows
 * the widget exists at picker-render time, before the JS bundle
 * is even fetched.
 *
 * @since 0.18.0
 */
function desktop_mode_register_heartbeat_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}
	desktop_mode_register_widget( 'desktop-mode/heartbeat', array(
		'label'          => __( 'Heartbeat', 'desktop-mode' ),
		'description'    => __(
			'A gently beating heart that pulses with the WordPress Heartbeat. The bar fills as the next tick approaches.',
			'desktop-mode'
		),
		'icon'           => 'dashicons-heart',
		'script'         => 'desktop-mode-heartbeat-widget',
		'movable'        => true,
		'resizable'      => false,
		'min_width'      => 310,
		'max_width'      => 310,
		'min_height'     => 230,
		'max_height'     => 230,
		'default_width'  => 310,
		'default_height' => 230,
	) );
}
add_action( 'init', 'desktop_mode_register_heartbeat_widget', 6 );

/**
 * Eagerly enqueue the widget's CSS handle on every Desktop Mode
 * admin page load. The JS bundle is still loaded lazily by the
 * shell's widget server-sync — only the CSS is eager.
 *
 * Why eager: the shell's `loadVendorScript()` injects a `<script>`
 * for the widget at runtime, but there is no matching auto-load
 * for the stylesheet. A pure-JS CSS injection works most of the
 * time but creates a flash of unstyled content while the link's
 * stylesheet is still in flight — long enough for the widget
 * frame's children to render past the card boundary before the
 * stylesheet's flex layout kicks in. 1.9 KB ungzipped is small
 * enough to live in the always-loaded set without measurable
 * cost; the heavier JS (9 KB + PIXI) stays lazy.
 *
 * @since 0.18.0
 */
function desktop_mode_enqueue_heartbeat_widget_styles() {
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-heartbeat-widget' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_heartbeat_widget_styles', 20 );
