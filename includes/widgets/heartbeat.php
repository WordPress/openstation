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
 * @since   0.8.5
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS bundle as a script handle so it can be loaded
 * lazily via `wp_register_script()` / its URL. The CSS file
 * emitted by Vite alongside the JS is registered as its own
 * style handle and eagerly enqueued by
 * desktop_mode_enqueue_heartbeat_widget_styles() below — the
 * widget server-sync only injects the JS, so the stylesheet must
 * ship ahead of time for the chrome to paint with the JS.
 *
 * @since 0.8.5
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
 * @since 0.8.5
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
 * Eagerly enqueue the widget's CSS handle when the current
 * request runs in Desktop Mode and is not a chromeless iframe
 * load. The JS bundle stays lazy and loads via the widget
 * server-sync the first time the picker opens or the widget
 * mounts.
 *
 * Why eager (on shell pages): the shell injects a `<script>` for
 * the widget at runtime, but there is no matching auto-load for
 * the stylesheet. A pure-JS CSS injection creates a flash of
 * unstyled content while the link's stylesheet is still in
 * flight — long enough for the widget frame's children to render
 * past the card boundary before the stylesheet's flex layout
 * kicks in. 1.9 KB ungzipped is small enough to live in the
 * shell's always-loaded set without measurable cost; the
 * heavier JS (9 KB + PIXI) stays lazy.
 *
 * Why NOT eager in chromeless iframes: they never mount widgets
 * themselves — sending the stylesheet there is dead weight. Note
 * that classic-override pages (`?desktop_mode_classic=1`) are
 * not excluded: they skip the shell but still receive the
 * (1.9 KB) stylesheet. The
 * `desktop_mode_heartbeat_widget_eager_css` filter lets a
 * site owner opt out entirely without forking the plugin.
 *
 * @since 0.8.5
 */
function desktop_mode_enqueue_heartbeat_widget_styles() {
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return;
	}
	// Chromeless requests render content inside an iframe owned
	// by a shell elsewhere — they never mount widgets themselves.
	if (
		function_exists( 'desktop_mode_is_chromeless_request' )
		&& desktop_mode_is_chromeless_request()
	) {
		return;
	}
	/**
	 * Whether to enqueue the heartbeat widget's stylesheet on
	 * this request. Defaults to `true` for shell requests in
	 * Desktop Mode. Sites that never plan to ship the heartbeat
	 * widget can return `false` and save the ~0.66 KB gzipped
	 * stylesheet roundtrip.
	 *
	 * @since 0.8.5
	 *
	 * @param bool $eager Default `true` once the chromeless +
	 *                    desktop-mode gates above have passed.
	 */
	$eager = (bool) apply_filters( 'desktop_mode_heartbeat_widget_eager_css', true );
	if ( ! $eager ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-heartbeat-widget' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_heartbeat_widget_styles', 20 );
