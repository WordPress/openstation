<?php
/**
 * Desktop Mode — Post Stats Widget.
 *
 * Bar chart of posts published per month for the last 6 months,
 * broken down by published / draft / pending status.
 *
 * Refresh: every 5 minutes.
 * Requires: Desktop Mode 0.18.0+ (desktop_mode_register_widget).
 *
 * @package WPDesktopMode
 * @since   0.26.0
 */

defined( 'ABSPATH' ) || exit;

/**
 * Register the JS + CSS assets.
 *
 * @since 0.26.0
 */
function desktop_mode_register_post_stats_widget_assets() {
	$suffix  = ( defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ) ? '' : '.min';
	$version = defined( 'DESKTOP_MODE_VERSION' ) ? DESKTOP_MODE_VERSION : '0';

	$js_path  = DESKTOP_MODE_DIR . 'assets/js/widget-post-stats' . $suffix . '.js';
	$css_path = DESKTOP_MODE_DIR . 'assets/js/widget-post-stats' . $suffix . '.css';

	wp_register_style(
		'desktop-mode-post-stats-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-post-stats' . $suffix . '.css',
		array(),
		file_exists( $css_path ) ? (string) filemtime( $css_path ) : $version
	);

	wp_register_script(
		'desktop-mode-post-stats-widget',
		DESKTOP_MODE_URL . 'assets/js/widget-post-stats' . $suffix . '.js',
		array( 'wp-api-fetch' ),
		file_exists( $js_path ) ? (string) filemtime( $js_path ) : $version,
		true
	);
}
add_action( 'init', 'desktop_mode_register_post_stats_widget_assets', 5 );

/**
 * Eagerly enqueue the CSS on shell pages.
 *
 * @since 0.26.0
 */
function desktop_mode_enqueue_post_stats_widget_styles() {
	if ( function_exists( 'desktop_mode_is_enabled' ) && ! desktop_mode_is_enabled() ) {
		return;
	}
	if ( function_exists( 'desktop_mode_is_chromeless_request' ) && desktop_mode_is_chromeless_request() ) {
		return;
	}
	wp_enqueue_style( 'desktop-mode-post-stats-widget' );
}
add_action( 'admin_enqueue_scripts', 'desktop_mode_enqueue_post_stats_widget_styles', 20 );

/**
 * Register the widget definition.
 *
 * @since 0.26.0
 */
function desktop_mode_register_post_stats_widget() {
	if ( ! function_exists( 'desktop_mode_register_widget' ) ) {
		return;
	}
	desktop_mode_register_widget(
		'desktop-mode/post-stats',
		array(
			'label'          => __( 'Post Stats', 'desktop-mode' ),
			'description'    => __( 'Bar chart of posts per month over the last 6 months.', 'desktop-mode' ),
			'icon'           => 'dashicons-chart-bar',
			'script'         => 'desktop-mode-post-stats-widget',
			'movable'        => true,
			'resizable'      => true,
			'min_width'      => 260,
			'min_height'     => 200,
			'default_width'  => 320,
			'default_height' => 260,
		)
	);
}
add_action( 'init', 'desktop_mode_register_post_stats_widget', 6 );
